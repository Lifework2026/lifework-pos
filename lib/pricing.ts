/**
 * Pricing engine for POS sales, returns and quotes.
 *
 * Pure and client-safe: no Prisma, no I/O. All money is integer satang
 * (1 baht = 100 satang) and all discount arithmetic uses BigInt, so every
 * discount is allocated across lines exactly, with no rounding drift.
 *
 * Order of operations:
 *   1. Promotion (applies to eligible lines, excludes shopping bags)
 *   2. Member discount (percent, applies to non-bag lines, after promotion)
 *   3. Manual discount (cashier-entered, applies to all lines)
 *   4. Points redemption (1 point = pointValueSatang, applies to all lines)
 * Each step is allocated to lines in proportion to what remains on each line.
 */

export class PricingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

export interface PricingLine {
  key: string;
  unitPriceSatang: number;
  quantity: number;
  isBag: boolean;
  /** Whether the active promotion applies to this line (scope and category are resolved by the caller). */
  promoEligible: boolean;
}

export interface PricingPromotion {
  name: string;
  kind: "PERCENT_OFF" | "AMOUNT_OFF";
  /** PERCENT_OFF: hundredths of a percent (10% = 1000). AMOUNT_OFF: satang. */
  valueScaled: number;
  minSubtotalSatang: number;
}

export interface PricingInput {
  lines: PricingLine[];
  promotion?: PricingPromotion | null;
  /** Member discount in hundredths of a percent. 0 when there is no member. */
  memberDiscountScaled?: number;
  manualDiscountSatang?: number;
  pointsToRedeem?: number;
  /** Points the member holds before this sale. 0 when there is no member. */
  pointsBalance?: number;
  pointValueSatang: number;
  /** Earn one point for every this many satang of merchandise paid. */
  earnThresholdSatang: number;
  isMember: boolean;
}

export interface LineResult {
  key: string;
  subtotal: number;
  promotionDiscount: number;
  memberDiscount: number;
  manualDiscount: number;
  pointsDiscount: number;
  discount: number;
  net: number;
}

export interface PricingResult {
  lines: LineResult[];
  promotionName: string | null;
  subtotal: number;
  promotionDiscount: number;
  memberDiscount: number;
  manualDiscount: number;
  pointsDiscount: number;
  discount: number;
  total: number;
  pointsRedeemed: number;
  pointsEarned: number;
}

const TEN_THOUSAND = BigInt(10_000);

/**
 * Splits `total` across `weights` in proportion to each weight. Returns integers that
 * sum to exactly `total`. Leftover satang go to the largest remainders, ties go to earlier lines.
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const weightSum = weights.reduce((sum, w) => sum + w, BigInt(0));
  const shares = weights.map(() => BigInt(0));
  if (total === BigInt(0) || weightSum === BigInt(0)) return shares;

  const remainders: bigint[] = [];
  let distributed = BigInt(0);
  weights.forEach((weight, index) => {
    const product = total * weight;
    shares[index] = product / weightSum;
    remainders.push(product % weightSum);
    distributed += shares[index];
  });

  let leftover = total - distributed;
  const order = weights
    .map((weight, index) => ({ index, remainder: remainders[index], weight }))
    .filter((entry) => entry.weight > BigInt(0))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));

  for (const entry of order) {
    if (leftover === BigInt(0)) break;
    shares[entry.index] += BigInt(1);
    leftover -= BigInt(1);
  }
  return shares;
}

/** Rounds `value * scaled / 10000` to the nearest satang (half up). */
function scaledShare(value: bigint, scaled: bigint): bigint {
  return (value * scaled + BigInt(5000)) / TEN_THOUSAND;
}

function assertInt(value: number, label: string, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new PricingError("INVALID_AMOUNT", `${label} must be an integer of at least ${min}.`);
  }
}

/** Computes every line's discounts and net amount, plus order totals and loyalty points. */
export function calculatePricing(input: PricingInput): PricingResult {
  if (input.lines.length === 0) {
    throw new PricingError("EMPTY_CART", "Add at least one item.");
  }
  for (const line of input.lines) {
    assertInt(line.unitPriceSatang, `Price of ${line.key}`, 0);
    assertInt(line.quantity, `Quantity of ${line.key}`, 1);
  }

  const manualDiscount = input.manualDiscountSatang ?? 0;
  const pointsToRedeem = input.pointsToRedeem ?? 0;
  const pointsBalance = input.pointsBalance ?? 0;
  const memberScaled = input.memberDiscountScaled ?? 0;
  assertInt(manualDiscount, "Manual discount", 0);
  assertInt(pointsToRedeem, "Points to redeem", 0);
  if (pointsToRedeem > pointsBalance) {
    throw new PricingError("POINTS_EXCEED_BALANCE", `Only ${pointsBalance} points are available.`);
  }

  const zeros = () => input.lines.map(() => BigInt(0));
  const subtotals = input.lines.map((line) => BigInt(line.unitPriceSatang) * BigInt(line.quantity));
  const subtotal = subtotals.reduce((sum, value) => sum + value, BigInt(0));

  const promoShares = zeros();
  let promotionName: string | null = null;
  let promotionDiscount = BigInt(0);
  if (input.promotion) {
    const promo = input.promotion;
    const eligibleBase = input.lines.reduce(
      (sum, line, i) => (line.promoEligible && !line.isBag ? sum + subtotals[i] : sum),
      BigInt(0),
    );
    if (eligibleBase === BigInt(0) || eligibleBase < BigInt(promo.minSubtotalSatang)) {
      throw new PricingError("PROMOTION_NOT_APPLICABLE", `${promo.name} does not apply to this basket.`);
    }
    promotionName = promo.name;
    promotionDiscount =
      promo.kind === "PERCENT_OFF"
        ? scaledShare(eligibleBase, BigInt(promo.valueScaled))
        : minBigInt(BigInt(promo.valueScaled), eligibleBase);

    const weights = input.lines.map((line, i) => (line.promoEligible && !line.isBag ? subtotals[i] : BigInt(0)));
    allocate(promotionDiscount, weights).forEach((share, i) => (promoShares[i] = share));
  }

  const afterPromo = subtotals.map((value, i) => value - promoShares[i]);

  const memberShares = zeros();
  let memberDiscount = BigInt(0);
  if (memberScaled > 0) {
    const nonBagBase = input.lines.reduce(
      (sum, line, i) => (line.isBag ? sum : sum + afterPromo[i]),
      BigInt(0),
    );
    memberDiscount = scaledShare(nonBagBase, BigInt(memberScaled));
    const weights = input.lines.map((line, i) => (line.isBag ? BigInt(0) : afterPromo[i]));
    allocate(memberDiscount, weights).forEach((share, i) => (memberShares[i] = share));
  }

  const afterMember = afterPromo.map((value, i) => value - memberShares[i]);
  const afterMemberTotal = afterMember.reduce((sum, value) => sum + value, BigInt(0));

  if (BigInt(manualDiscount) > afterMemberTotal) {
    throw new PricingError("DISCOUNT_EXCEEDS_TOTAL", "Manual discount cannot be larger than the amount payable.");
  }
  const manualShares = allocate(BigInt(manualDiscount), afterMember);
  const afterManual = afterMember.map((value, i) => value - manualShares[i]);

  const pointsDiscount = BigInt(pointsToRedeem) * BigInt(input.pointValueSatang);
  const afterManualTotal = afterManual.reduce((sum, value) => sum + value, BigInt(0));
  if (pointsDiscount > afterManualTotal) {
    throw new PricingError("POINTS_EXCEED_TOTAL", "Points discount is larger than the amount payable.");
  }
  const pointsShares = allocate(pointsDiscount, afterManual);
  const net = afterManual.map((value, i) => value - pointsShares[i]);
  const total = net.reduce((sum, value) => sum + value, BigInt(0));
  if (total <= BigInt(0)) {
    throw new PricingError("EMPTY_TOTAL", "The amount payable must be greater than zero.");
  }

  let pointsEarned = 0;
  if (input.isMember) {
    const merchandiseNet = input.lines.reduce(
      (sum, line, i) => (line.isBag ? sum : sum + net[i]),
      BigInt(0),
    );
    pointsEarned = Number(merchandiseNet / BigInt(input.earnThresholdSatang));
  }

  const lines: LineResult[] = input.lines.map((line, i) => {
    const discount = promoShares[i] + memberShares[i] + manualShares[i] + pointsShares[i];
    return {
      key: line.key,
      subtotal: Number(subtotals[i]),
      promotionDiscount: Number(promoShares[i]),
      memberDiscount: Number(memberShares[i]),
      manualDiscount: Number(manualShares[i]),
      pointsDiscount: Number(pointsShares[i]),
      discount: Number(discount),
      net: Number(net[i]),
    };
  });

  const totalDiscount = promotionDiscount + memberDiscount + BigInt(manualDiscount) + pointsDiscount;
  return {
    lines,
    promotionName,
    subtotal: Number(subtotal),
    promotionDiscount: Number(promotionDiscount),
    memberDiscount: Number(memberDiscount),
    manualDiscount,
    pointsDiscount: Number(pointsDiscount),
    discount: Number(totalDiscount),
    total: Number(total),
    pointsRedeemed: pointsToRedeem,
    pointsEarned,
  };
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Refund amount for moving a line from `fromQty` to `toQty` refunded units, out of `originalQty`.
 * Computed as a difference of cumulative shares, so refunding in any number of steps sums to exactly
 * the line's net amount once every unit is refunded.
 */
export function refundShare(netSatang: number, originalQty: number, fromQty: number, toQty: number): number {
  if (toQty < fromQty || toQty > originalQty || fromQty < 0) {
    throw new PricingError("INVALID_REFUND_QUANTITY", "Refund quantity is out of range.");
  }
  const cumulative = (qty: number) =>
    (BigInt(netSatang) * BigInt(qty) * BigInt(2) + BigInt(originalQty)) / (BigInt(originalQty) * BigInt(2));
  return Number(cumulative(toQty) - cumulative(fromQty));
}

/** Formats integer satang as a plain decimal string with 2 places, e.g. 89000 -> "890.00". */
export function satangToDecimal(satang: number): string {
  const negative = satang < 0;
  const abs = Math.abs(satang);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Converts a baht value (number or decimal string with at most 2 places) to satang. Throws on more precision. */
export function bahtToSatang(value: number | string): number {
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new PricingError("INVALID_AMOUNT", `"${value}" is not a valid baht amount.`);
  }
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const satang = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -satang : satang;
}


export interface RefundSlot {
  key: string;
  /** Amount originally applied to this payment line, in satang. */
  amountSatang: number;
  /** Amount already refunded through this line, in satang. */
  refundedSatang: number;
}

/**
 * Returns a refund to the original payment lines, in the order they were paid.
 * Each line gives back at most what it still has refundable. The result is exact.
 */
export function allocateRefund(refundSatang: number, slots: RefundSlot[]): { key: string; amountSatang: number }[] {
  if (!Number.isSafeInteger(refundSatang) || refundSatang <= 0) {
    throw new PricingError("INVALID_AMOUNT", "Refund amount must be greater than zero.");
  }
  let left = refundSatang;
  const parts: { key: string; amountSatang: number }[] = [];
  for (const slot of slots) {
    const available = Math.max(0, slot.amountSatang - slot.refundedSatang);
    const take = Math.min(available, left);
    if (take > 0) {
      parts.push({ key: slot.key, amountSatang: take });
      left -= take;
    }
  }
  if (left > 0) {
    throw new PricingError("REFUND_EXCEEDS_PAYMENTS", "The refund is larger than the amount still refundable.");
  }
  return parts;
}
