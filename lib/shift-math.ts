/**
 * Cash-drawer arithmetic. Pure functions, client-safe, all amounts in integer satang so the drawer
 * count can never drift by a rounding error.
 */

export const MAX_OPENING_FLOAT_SATANG = 10_000_000; // 100,000 baht
export const MAX_COUNTED_CASH_SATANG = 1_000_000_000; // 10,000,000 baht

/** Baht typed by a person (number of baht, at most 2 decimals) to satang, or null if it is not a valid amount. */
export function bahtToSatang(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const satang = Math.round(value * 100);
  if (Math.abs(value * 100 - satang) > 1e-6) return null;
  return satang;
}

export interface ExpectedCashParts {
  openingFloat: number;
  cashSales: number;
  /** Cash paid back to customers for refunds. */
  cashRefunds: number;
  /** Cash paid back because a whole bill was voided. */
  cashVoids: number;
}

/** What should be in the drawer: float plus cash taken, minus cash paid out. */
export function expectedCashSatang(parts: ExpectedCashParts): number {
  return parts.openingFloat + parts.cashSales - parts.cashRefunds - parts.cashVoids;
}

export type VarianceKind = "BALANCED" | "OVER" | "SHORT";

/** counted minus expected: negative is short, positive is over. */
export function varianceSatang(counted: number, expected: number): number {
  return counted - expected;
}

export function varianceKind(variance: number): VarianceKind {
  if (variance === 0) return "BALANCED";
  return variance > 0 ? "OVER" : "SHORT";
}
