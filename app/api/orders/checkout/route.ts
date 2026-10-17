import type { NextRequest } from "next/server";
import { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { LOYALTY } from "@/lib/store-config";
import { satangToDecimal, type PricingResult } from "@/lib/pricing";
import { splitInclusiveVat } from "@/lib/tax-rules";
import { priceBasket, type BasketInput, type PricedBasket } from "@/lib/orders/context";
import { OrderError } from "@/lib/orders/errors";
import { normalizePaymentLines, type NormalizedPaymentLine } from "@/lib/orders/payments";
import { checkoutSchema, type CheckoutInput } from "@/lib/orders/schemas";
import { orderSelect, serializeOrder, type OrderRecord } from "@/lib/orders/serialize";
import { EdcServiceError } from "@/lib/edc/service";
import { getOpenShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

const RECEIPT_TIMEZONE = "Asia/Bangkok";

function toBasketInput(input: CheckoutInput): BasketInput {
  return {
    items: input.items,
    bag: input.bag,
    memberId: input.memberId ?? null,
    promotionId: input.promotionId ?? null,
    redeemPoints: input.redeemPoints,
    manualDiscount: input.manualDiscount,
  };
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
    throw new OrderError(409, "RECEIPT_SEQUENCE_EXHAUSTED", "No receipt numbers left for today.");
  }
  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}

/** Confirms each card line is an approved, unused terminal payment for the exact line amount. */
async function verifyCardPayments(tx: Prisma.TransactionClient, payments: NormalizedPaymentLine[]): Promise<void> {
  for (const payment of payments) {
    if (!payment.edcPaymentId) continue;
    const edc = await tx.edcPayment.findUnique({
      where: { id: payment.edcPaymentId },
      select: { status: true, amount: true, payment: { select: { id: true } } },
    });
    if (!edc || edc.status !== "SUCCESS" || edc.payment) {
      throw new OrderError(409, "EDC_PAYMENT_NOT_AVAILABLE", "A card payment is not approved or was already used.");
    }
    if (Math.round(Number(edc.amount) * 100) !== payment.amountSatang) {
      throw new OrderError(409, "EDC_PAYMENT_NOT_AVAILABLE", "A card payment does not match its payment amount.");
    }
  }
}

async function placeOrder(tx: Prisma.TransactionClient, input: CheckoutInput, cashierId: string): Promise<OrderRecord> {
  // Every sale belongs to a cash-drawer shift, so the drawer can be counted against the receipts.
  const shift = await getOpenShift(tx, cashierId);
  if (!shift) throw new OrderError(409, "SHIFT_REQUIRED", "Open a shift and declare the starting cash before selling.");

  const basket: PricedBasket = await priceBasket(tx, toBasketInput(input));
  const pricing: PricingResult = basket.pricing;

  const payments = normalizePaymentLines(input.payments, pricing.total);
  await verifyCardPayments(tx, payments);

  // Decrement stock for every line (including bags). Guarded so two sales cannot take the same units.
  for (const line of basket.lines) {
    const result = await tx.productVariant.updateMany({
      where: { id: line.variantId, stockQuantity: { gte: line.quantity } },
      data: { stockQuantity: { decrement: line.quantity } },
    });
    if (result.count !== 1) {
      throw new OrderError(409, "INSUFFICIENT_STOCK", `${line.sku} sold out while checking out.`, {
        variantId: line.variantId,
      });
    }
  }

  if (basket.member) {
    const earned = pricing.pointsEarned;
    const redeemed = pricing.pointsRedeemed;
    const result = await tx.member.updateMany({
      where: { id: basket.member.id, points: basket.member.points },
      data: { points: basket.member.points - redeemed + earned },
    });
    if (result.count !== 1) {
      throw new OrderError(409, "CONFLICT", "The member's points changed during checkout. Please try again.");
    }
  }

  const receiptNo = await nextReceiptNumber(tx, new Date());
  const resultByKey = new Map(pricing.lines.map((line) => [line.key, line]));
  // Prices include VAT. The split is taken from what the customer actually pays, after every discount.
  const { netSatang, vatSatang } = splitInclusiveVat(pricing.total);

  const order = await tx.order.create({
    data: {
      receiptNo,
      cashierId,
      shiftId: shift.id,
      status: OrderStatus.COMPLETED,
      memberId: basket.member?.id ?? null,
      promotionId: basket.promotion?.id ?? null,
      bagType: input.bag,
      subtotal: satangToDecimal(pricing.subtotal),
      promotionDiscount: satangToDecimal(pricing.promotionDiscount),
      memberDiscount: satangToDecimal(pricing.memberDiscount),
      manualDiscount: satangToDecimal(pricing.manualDiscount),
      pointsDiscount: satangToDecimal(pricing.pointsDiscount),
      totalAmount: satangToDecimal(pricing.total),
      netAmount: satangToDecimal(netSatang),
      vatAmount: satangToDecimal(vatSatang),
      pointsRedeemed: pricing.pointsRedeemed,
      pointsEarned: pricing.pointsEarned,
      items: {
        create: basket.lines.map((line) => {
          const result = resultByKey.get(line.key);
          if (!result) throw new Error(`Missing pricing for ${line.key}`);
          return {
            variantId: line.variantId,
            productName: line.productName,
            productNameTh: line.productNameTh,
            sku: line.sku,
            barcode: line.barcode,
            size: line.size,
            color: line.color,
            isBag: line.isBag,
            quantity: line.quantity,
            unitPrice: satangToDecimal(line.unitPriceSatang),
            lineSubtotal: satangToDecimal(result.subtotal),
            discountAmount: satangToDecimal(result.discount),
            netAmount: satangToDecimal(result.net),
          };
        }),
      },
    },
    select: { id: true },
  });

  await tx.payment.createMany({
    data: payments.map((payment) => ({
      orderId: order.id,
      method: payment.method,
      amount: satangToDecimal(payment.amountSatang),
      tendered: payment.tenderedSatang === null ? null : satangToDecimal(payment.tenderedSatang),
      changeGiven: payment.tenderedSatang === null ? null : satangToDecimal(payment.changeSatang),
      reference: payment.reference,
      edcPaymentId: payment.edcPaymentId,
    })),
  });

  await tx.inventoryMovement.createMany({
    data: basket.lines.map((line) => ({
      variantId: line.variantId,
      type: "SALE",
      quantityChange: -line.quantity,
      stockBefore: line.stockQuantity,
      stockAfter: line.stockQuantity - line.quantity,
      reference: receiptNo,
      orderId: order.id,
      userId: cashierId,
    })),
  });

  return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect });
}

function handleError(err: unknown): Response {
  if (err instanceof OrderError) {
    return apiError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof EdcServiceError) {
    return apiError(err.status, err.code, err.message);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2002")) {
    return apiError(409, "CONFLICT", "Another sale was processed at the same time, or a card payment was already used. Please try again.");
  }
  console.error("[POST /api/orders/checkout]", err);
  return apiError(500, "INTERNAL_ERROR", "Checkout failed. No stock or payments were changed.");
}

/**
 * POST /api/orders/checkout
 *
 * The cashier is the signed-in user. Prices the basket, checks payments against the
 * total, and writes everything in one serializable transaction: stock, order, items,
 * payments, member points and the inventory ledger. Any failure rolls it all back.
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
      parsed.error.issues[0]?.message ?? "Checkout payload is invalid.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }

  try {
    const order = await prisma.$transaction((tx) => placeOrder(tx, parsed.data, session.id), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 20_000,
    });
    return Response.json({ order: serializeOrder(order), loyalty: { earnThresholdBaht: LOYALTY.earnThresholdSatang / 100 } }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
