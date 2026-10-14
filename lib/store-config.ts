/**
 * Store settings. Client-safe. Change these for a different branch.
 * The store code is a placeholder until the official code is confirmed.
 */
export const STORE = {
  name: "Lifework",
  branch: "Mega Bangna",
  code: "LW-MBG-001",
} as const;

/** Loyalty: 1 point per baht of merchandise paid, and 1 point is worth 1 baht when redeemed. */
export const LOYALTY = {
  earnThresholdSatang: 10_000,
  pointValueSatang: 100,
} as const;

/** Member discount on merchandise, in hundredths of a percent (5% = 500). */
export const MEMBER_DISCOUNT_SCALED = 500;

/** Shopping bag products, looked up by SKU. Prices come from the database. */
export const BAG_SKUS = {
  SMALL: "BAG-SMALL",
  LARGE: "BAG-LARGE",
} as const;
