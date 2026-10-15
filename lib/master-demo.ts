/**
 * Clearing demo master data. Only the legacy demo codes (the CAT- and COL- scheme of the first seed and migration)
 * are candidates, and only when nothing uses them: no product, no promotion, no variant. Anything in use is kept and
 * listed with its count, so no sale, stock line or promotion can lose its category or colour.
 * Pure: the caller reads the counts and runs the deletes inside one serializable transaction.
 */

/** The phrase the user types to confirm. */
export const CLEAR_DEMO_PHRASE = "CLEAR DEMO";

const LEGACY_CODE = /^(CAT|COL)-/;

export function isLegacyDemoCode(code: string): boolean {
  return LEGACY_CODE.test(code);
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

/** Splits the legacy demo codes into the ones to delete and the ones kept. Codes outside the legacy scheme are never listed. */
export function planDemoClear(rows: DemoCandidate[]): DemoPlan {
  const remove: DemoPlan["remove"] = [];
  const keep: DemoPlan["keep"] = [];
  for (const row of rows) {
    if (!isLegacyDemoCode(row.code)) continue;
    if (row.uses === 0) remove.push({ id: row.id, code: row.code });
    else keep.push({ code: row.code, uses: row.uses });
  }
  return { remove, keep };
}
