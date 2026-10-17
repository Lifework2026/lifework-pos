/**
 * Clearing legacy master data. A record is a candidate only when it is outside the current standard and nothing uses it:
 * no product, no promotion, no variant. Anything in use is kept and listed with its count, so no sale, stock line or
 * promotion can lose its category or colour.
 *   - Category: any code outside the official two-letter dictionary (for example 00, SP, CAT-SHIRT).
 *   - Colour: the COL- scheme of the first seed. The numbered colours 00-23 are never candidates.
 * Pure: the caller reads the counts and runs the deletes inside one serializable transaction.
 */

import { OFFICIAL_CATEGORY_CODES } from "@/lib/catalog-matrix";

/** The phrase the user types to confirm. */
export const CLEAR_DEMO_PHRASE = "CLEAR DEMO";

export function isLegacyCategoryCode(code: string): boolean {
  return !OFFICIAL_CATEGORY_CODES.has(code);
}

export function isLegacyColorCode(code: string): boolean {
  return /^COL-/.test(code);
}

export interface DemoCandidate {
  id: string;
  code: string;
  /** Products, promotions or variants that use this record. */
  uses: number;
}

export interface DemoPlan {
  /** Legacy codes nothing uses. These are deleted. */
  remove: { id: string; code: string }[];
  /** Legacy codes still in use. These stay, with the count that keeps them. */
  keep: { code: string; uses: number }[];
}

/** Splits the legacy codes of one kind into the ones to delete and the ones kept. Current codes are never listed. */
export function planDemoClear(rows: DemoCandidate[], isLegacy: (code: string) => boolean): DemoPlan {
  const remove: DemoPlan["remove"] = [];
  const keep: DemoPlan["keep"] = [];
  for (const row of rows) {
    if (!isLegacy(row.code)) continue;
    if (row.uses === 0) remove.push({ id: row.id, code: row.code });
    else keep.push({ code: row.code, uses: row.uses });
  }
  return { remove, keep };
}
