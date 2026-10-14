import type { NextRequest } from "next/server";
import { Prisma, PaymentMethod, OrderStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, formatMoney } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { EdcServiceError, linkEdcPaymentToOrder } from "@/lib/edc/service";
import { orderSelect, serializeOrder, type OrderRecord } from "@/lib/orders/serialize";

export const dynamic = "force-dynamic";

const MAX_LINES = 200;
const MAX_QUANTITY_PER_LINE = 999;
const RECEIPT_TIMEZONE = "Asia/Bangkok";

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(MAX_LINES),
  paymentMethod: z.enum(PaymentMethod),
  /** Required for CASH. Ignored for other methods, which settle the exact total. */
  amountReceived: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  /** Required for CARD (credit / EDC). The approved terminal payment to attach to this order. */
  edcPaymentId: z.string().min(1).max(64).optional(),
});

type CheckoutInput = z.infer<typeof checkoutSchema>;
type CheckoutLine = { variantId: string; quantity: number; unitPrice: Prisma.Decimal };

/** Business-rule failure that maps to a specific HTTP status and error code. */
class CheckoutError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/** Merges duplicate variant lines so one variant is checked and decremented once. */
function mergeLines(items: CheckoutInput["items"]): CheckoutLine[] {
  const merged = new Map<string, CheckoutLine>();

  for (const item of items) {
    const unitPrice = new Prisma.Decimal(item.unitPrice).toDecimalPlaces(2);
    const existing = merged.get(item.variantId);

    if (!existing) {
      merged.set(item.variantId, { variantId: item.variantId, quantity: item.quantity, unitPrice });
      continue;
    }
    if (!existing.unitPrice.equals(unitPrice)) {
      throw new CheckoutError(400, "CONFLICTING_LINE_PRICE", "The same variant appears with two different prices.", {
        variantId: item.variantId,
      });
    }
    existing.quantity += item.quantity;
  }

  return Array.from(merged.values());
}

/** Receipt number format POS-YYYYMMDD-XXXX, with the date in store time (Bangkok). */
async function nextReceiptNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: RECEIPT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replace(/-/g, "");

  const prefix = `POS-${datePart}-`;
  const last = await tx.order.findFirst({
    where: { receiptNo: { startsWith: prefix } },
    orderBy: { receiptNo: "desc" },
    select: { receiptNo: true },
  });

  const nextSequence = last ? Number(last.receiptNo.slice(prefix.length)) + 1 : 1;
  if (nextSequence > 9999) {
    throw new CheckoutError(409, "RECEIPT_SEQUENCE_EXHAUSTED", "No receipt numbers left for today.");
  }

  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}

async function placeOrder(
  tx: Prisma.TransactionClient,
  input: CheckoutInput,
  lines: CheckoutLine[],
  cashierId: string,
): Promise<OrderRecord> {
  // (a) Load every variant and verify it is sellable, priced correctly and in stock.
  const variants = await tx.productVariant.findMany({
    where: { id: { in: lines.map((line) => line.variantId) } },
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      color: true,
      price: true,
      stockQuantity: true,
      isActive: true,
      product: { select: { name: true, isActive: true } },
    },
  });
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const priced = lines.map((line) => {
    const variant = variantById.get(line.variantId);
    if (!variant) {
      throw new CheckoutError(404, "VARIANT_NOT_FOUND", `Variant ${line.variantId} does not exist.`, {
        variantId: line.variantId,
      });
    }
    if (!variant.isActive || !variant.product.isActive) {
      throw new CheckoutError(409, "VARIANT_INACTIVE", `${variant.product.name} (${variant.sku}) is not for sale.`, {
        variantId: variant.id,
      });
    }
    // The database price is authoritative. A mismatch means the POS showed a stale price.
    if (!line.unitPrice.equals(variant.price)) {
      throw new CheckoutError(409, "PRICE_MISMATCH", `The price of ${variant.sku} has changed. Refresh and try again.`, {
        variantId: variant.id,
        expected: formatMoney(variant.price),
        received: formatMoney(line.unitPrice),
      });
    }
    if (variant.stockQuantity < line.quantity) {
      throw new CheckoutError(409, "INSUFFICIENT_STOCK", `Only ${variant.stockQuantity} of ${variant.sku} left in stock.`, {
        variantId: variant.id,
        requested: line.quantity,
        available: variant.stockQuantity,
      });
    }

    return { variant, quantity: line.quantity, lineTotal: variant.price.mul(line.quantity) };
  });

  const subtotal = priced.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
  const discount = new Prisma.Decimal(input.discountAmount).toDecimalPlaces(2);
  if (discount.gt(subtotal)) {
    throw new CheckoutError(400, "DISCOUNT_EXCEEDS_SUBTOTAL", "Discount cannot be larger than the subtotal.");
  }
  const total = subtotal.minus(discount);
  if (total.lte(0)) {
    throw new CheckoutError(400, "EMPTY_TOTAL", "The order total must be greater than zero.");
  }

  let amountReceived: Prisma.Decimal;
  let changeAmount: Prisma.Decimal;
  if (input.paymentMethod === PaymentMethod.CASH) {
    amountReceived = new Prisma.Decimal(input.amountReceived).toDecimalPlaces(2);
    if (amountReceived.lt(total)) {
      throw new CheckoutError(400, "INSUFFICIENT_TENDER", "Amount received is less than the total.", {
        total: formatMoney(total),
        received: formatMoney(amountReceived),
      });
    }
    changeAmount = amountReceived.minus(total);
  } else {
    // Non-cash payments settle the exact total, so there is no change.
    amountReceived = total;
    changeAmount = new Prisma.Decimal(0);
  }

  if (input.paymentMethod === PaymentMethod.CARD && !input.edcPaymentId) {
    throw new CheckoutError(400, "EDC_PAYMENT_REQUIRED", "Card payments must be approved on the EDC terminal first.");
  }

  // (d) Decrement stock. The guarded updateMany fails if another sale took the last units first.
  for (const line of priced) {
    const result = await tx.productVariant.updateMany({
      where: { id: line.variant.id, stockQuantity: { gte: line.quantity } },
      data: { stockQuantity: { decrement: line.quantity } },
    });
    if (result.count !== 1) {
      throw new CheckoutError(409, "INSUFFICIENT_STOCK", `${line.variant.sku} sold out while checking out.`, {
        variantId: line.variant.id,
      });
    }
  }

  const receiptNo = await nextReceiptNumber(tx, new Date());

  // (b) and (c) Create the order and its items, snapshotting names, SKUs and prices.
  const order = await tx.order.create({
    data: {
      receiptNo,
      cashierId,
      status: OrderStatus.COMPLETED,
      subtotal,
      discountAmount: discount,
      totalAmount: total,
      paymentMethod: input.paymentMethod,
      amountReceived,
      changeAmount,
      items: {
        create: priced.map(({ variant, quantity, lineTotal }) => ({
          variantId: variant.id,
          productName: variant.product.name,
          sku: variant.sku,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity,
          unitPrice: variant.price,
          lineTotal,
        })),
      },
    },
    select: orderSelect,
  });

  // Ledger entries for the sale, written in the same transaction as the stock change.
  await tx.inventoryMovement.createMany({
    data: priced.map(({ variant, quantity }) => ({
      variantId: variant.id,
      type: "SALE",
      quantityChange: -quantity,
      stockBefore: variant.stockQuantity,
      stockAfter: variant.stockQuantity - quantity,
      reference: receiptNo,
      orderId: order.id,
      userId: cashierId,
    })),
  });

  if (input.paymentMethod === PaymentMethod.CARD && input.edcPaymentId) {
    await linkEdcPaymentToOrder(tx, { paymentId: input.edcPaymentId, orderId: order.id, total });
    // Re-read so the returned order includes the linked terminal payment.
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect });
  }

  return order;
}

function handleError(err: unknown): Response {
  if (err instanceof CheckoutError) {
    return apiError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof EdcServiceError) {
    return apiError(err.status, err.code, err.message);
  }
  // P2034: serialization failure or write conflict. The client should retry.
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2002")) {
    return apiError(409, "CONFLICT", "Another sale was processed at the same time. Please try again.");
  }
  console.error("[POST /api/orders/checkout]", err);
  return apiError(500, "INTERNAL_ERROR", "Checkout failed. No stock was changed.");
}

/**
 * POST /api/orders/checkout
 *
 * The cashier is the signed-in user. Verifies stock and prices, decrements
 * stock, writes the order, its item snapshots and the ledger entries, and
 * links an approved EDC payment for card sales. All in one serializable
 * transaction. Any failure rolls it all back.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = checkoutSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Checkout payload is invalid.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }

  try {
    const lines = mergeLines(parsed.data.items);
    const order = await prisma.$transaction(
      (tx) => placeOrder(tx, parsed.data, lines, session.id),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );

    return Response.json({ order: serializeOrder(order) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
