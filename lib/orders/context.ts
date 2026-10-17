import type { Prisma } from "@prisma/client";
import { BAG_SKUS, LOYALTY, MEMBER_DISCOUNT_SCALED } from "@/lib/store-config";
import { bahtToSatang, calculatePricing, PricingError, type PricingResult } from "@/lib/pricing";
import { OrderError } from "@/lib/orders/errors";
import { isFreeBag } from "@/lib/catalog/free-bags";

/** Input for quoting or charging a basket. Prices are the amounts the till displayed, in baht. */
export interface BasketInput {
  items: { variantId: string; quantity: number; unitPrice: number }[];
  bag: "NONE" | "SMALL" | "LARGE";
  memberId: string | null;
  promotionId: string | null;
  redeemPoints: number;
  manualDiscount: number;
}

export interface PricedLine {
  key: string;
  variantId: string;
  productName: string;
  productNameTh: string | null;
  categoryId: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  stockQuantity: number;
  isBag: boolean;
  quantity: number;
  unitPriceSatang: number;
}

export interface PricedBasket {
  lines: PricedLine[];
  member: { id: string; name: string; phone: string; points: number } | null;
  promotion: { id: string; name: string } | null;
  pricing: PricingResult;
}

const MAX_QUANTITY = 999;

const variantSelect = {
  id: true,
  sku: true,
  barcode: true,
  size: true,
  color: true,
  price: true,
  stockQuantity: true,
  isActive: true,
  product: { select: { name: true, nameTh: true, isActive: true, categoryId: true } },
} as const;

/**
 * Loads prices, stock, member and promotion from the database and runs the pricing engine.
 * The four reads run in parallel, which keeps the round trips to the database to one.
 * Accepts the Prisma client or a transaction client, so checkout can price inside its transaction.
 */
export async function priceBasket(db: Prisma.TransactionClient, input: BasketInput): Promise<PricedBasket> {
  if (input.items.length === 0) {
    throw new OrderError(400, "EMPTY_CART", "Add at least one item.");
  }

  // Merge repeated variants into one line, but only when they carry the same price.
  const merged = new Map<string, { quantity: number; unitPrice: number }>();
  for (const item of input.items) {
    const existing = merged.get(item.variantId);
    if (!existing) {
      merged.set(item.variantId, { quantity: item.quantity, unitPrice: item.unitPrice });
    } else if (existing.unitPrice !== item.unitPrice) {
      throw new OrderError(400, "CONFLICTING_LINE_PRICE", "The same item appears at two different prices.");
    } else {
      existing.quantity += item.quantity;
    }
  }
  for (const [variantId, line] of Array.from(merged.entries())) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new OrderError(400, "INVALID_QUANTITY", `Quantity for ${variantId} must be between 1 and ${MAX_QUANTITY}.`);
    }
  }

  const now = new Date();
  const [variantRows, bagRow, memberRow, promotionRow] = await Promise.all([
    db.productVariant.findMany({
      where: { id: { in: Array.from(merged.keys()) } },
      select: variantSelect,
    }),
    input.bag !== "NONE"
      ? db.productVariant.findUnique({ where: { sku: BAG_SKUS[input.bag] }, select: variantSelect })
      : Promise.resolve(null),
    input.memberId
      ? db.member.findUnique({
          where: { id: input.memberId },
          select: { id: true, name: true, phone: true, points: true, isActive: true },
        })
      : Promise.resolve(null),
    input.promotionId ? db.promotion.findUnique({ where: { id: input.promotionId } }) : Promise.resolve(null),
  ]);

  const variantById = new Map(variantRows.map((row) => [row.id, row]));
  const lines: PricedLine[] = [];
  for (const [variantId, requested] of Array.from(merged.entries())) {
    const variant = variantById.get(variantId);
    if (!variant) {
      throw new OrderError(404, "VARIANT_NOT_FOUND", `Item ${variantId} does not exist.`, { variantId });
    }
    if (!variant.isActive || !variant.product.isActive) {
      throw new OrderError(409, "VARIANT_INACTIVE", `${variant.product.name} (${variant.sku}) is not for sale.`, {
        variantId,
      });
    }
    const dbPrice = Math.round(Number(variant.price) * 100);
    if (bahtToSatang(requested.unitPrice) !== dbPrice) {
      throw new OrderError(409, "PRICE_MISMATCH", `The price of ${variant.sku} has changed. Refresh and try again.`, {
        variantId,
        expected: variant.price.toFixed(2),
        received: requested.unitPrice.toFixed(2),
      });
    }
    // A free shopping bag is not counted, so it never runs out.
    if (variant.stockQuantity < requested.quantity && !isFreeBag(variant.sku)) {
      throw new OrderError(409, "INSUFFICIENT_STOCK", `Only ${variant.stockQuantity} of ${variant.sku} left in stock.`, {
        variantId,
        requested: requested.quantity,
        available: variant.stockQuantity,
      });
    }

    lines.push({
      key: variantId,
      variantId,
      productName: variant.product.name,
      productNameTh: variant.product.nameTh,
      categoryId: variant.product.categoryId,
      sku: variant.sku,
      barcode: variant.barcode,
      size: variant.size,
      color: variant.color,
      stockQuantity: variant.stockQuantity,
      isBag: false,
      quantity: requested.quantity,
      unitPriceSatang: dbPrice,
    });
  }

  if (input.bag !== "NONE") {
    const bag = bagRow;
    if (!bag || !bag.isActive || !bag.product.isActive) {
      throw new OrderError(409, "BAG_NOT_CONFIGURED", `The ${input.bag.toLowerCase()} shopping bag is not set up.`);
    }
    if (bag.stockQuantity < 1) {
      throw new OrderError(409, "BAG_OUT_OF_STOCK", `No ${input.bag.toLowerCase()} shopping bags left.`);
    }
    lines.push({
      key: `bag:${bag.id}`,
      variantId: bag.id,
      productName: bag.product.name,
      productNameTh: bag.product.nameTh,
      categoryId: bag.product.categoryId,
      sku: bag.sku,
      barcode: bag.barcode,
      size: bag.size,
      color: bag.color,
      stockQuantity: bag.stockQuantity,
      isBag: true,
      quantity: 1,
      unitPriceSatang: Math.round(Number(bag.price) * 100),
    });
  }

  let member: PricedBasket["member"] = null;
  if (input.memberId) {
    if (!memberRow || !memberRow.isActive) {
      throw new OrderError(404, "MEMBER_NOT_FOUND", "That member is not found or inactive.");
    }
    member = { id: memberRow.id, name: memberRow.name, phone: memberRow.phone, points: memberRow.points };
  }
  if (input.redeemPoints > 0 && !member) {
    throw new OrderError(400, "MEMBER_REQUIRED", "Select a member before redeeming points.");
  }

  let promotion: PricedBasket["promotion"] = null;
  let pricingPromotion: Parameters<typeof calculatePricing>[0]["promotion"] = null;
  let promotionScope: "ORDER" | "CATEGORY" = "ORDER";
  let promotionCategoryId: string | null = null;
  if (input.promotionId) {
    const row = promotionRow;
    if (!row || !row.isActive || row.startsAt > now || row.endsAt < now) {
      throw new OrderError(400, "PROMOTION_NOT_AVAILABLE", "That promotion is not active today.");
    }
    promotion = { id: row.id, name: row.name };
    promotionScope = row.scope;
    promotionCategoryId = row.categoryId;
    if (row.scope === "CATEGORY" && !row.categoryId) {
      throw new OrderError(500, "PROMOTION_MISCONFIGURED", "This promotion has no category set.");
    }
    pricingPromotion = {
      name: row.name,
      kind: row.kind,
      valueScaled: row.kind === "PERCENT_OFF" ? Math.round(Number(row.value) * 100) : bahtToSatang(row.value.toFixed(2)),
      minSubtotalSatang: bahtToSatang(row.minSubtotal.toFixed(2)),
    };
  }

  const manualDiscountSatang = bahtToSatang(input.manualDiscount);

  let pricing: PricingResult;
  try {
    pricing = calculatePricing({
      lines: lines.map((line) => ({
        key: line.key,
        unitPriceSatang: line.unitPriceSatang,
        quantity: line.quantity,
        isBag: line.isBag,
        promoEligible: promotion !== null && (promotionScope === "ORDER" || line.categoryId === promotionCategoryId),
      })),
      promotion: pricingPromotion,
      memberDiscountScaled: member ? MEMBER_DISCOUNT_SCALED : 0,
      manualDiscountSatang,
      pointsToRedeem: input.redeemPoints,
      pointsBalance: member?.points ?? 0,
      pointValueSatang: LOYALTY.pointValueSatang,
      earnThresholdSatang: LOYALTY.earnThresholdSatang,
      isMember: member !== null,
    });
  } catch (err) {
    if (err instanceof PricingError) {
      throw new OrderError(400, err.code, err.message);
    }
    throw err;
  }

  return { lines, member, promotion, pricing };
}
