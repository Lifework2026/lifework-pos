import { OFFICIAL_CATEGORY_CODES, MATRIX_CATEGORIES } from "@/lib/catalog-matrix";

/**
 * Moves categories onto the official two-letter dictionary. Pure: the caller reads the live categories, runs the plan,
 * and writes it in one serializable transaction.
 *
 * Rules:
 *   - Every dictionary code exists afterwards. A missing one is created with its official name.
 *   - A dictionary code whose name differs from the official name is renamed to the official name. Its id is kept.
 *   - A legacy category in the mapping moves its products and promotions to the target, then it is deleted.
 *   - A legacy category outside the mapping is deleted only when nothing uses it. If something uses it, the plan aborts.
 *   - Nothing is deleted while a product or promotion still points at it.
 */

/** Old code to new dictionary code. Several old codes can merge into one target. */
export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  "00": "TS",
  "01": "TL",
  "02": "SR",
  "CAT-SHIRT": "SR",
  "03": "TS",
  "04": "SR",
  "05": "WL",
  "CAT-PANT": "WL",
  "06": "WS",
  "07": "SK",
  "08": "OP",
  "CAT-DRESS": "OP",
  "09": "CT",
  "CAT-OUTER": "CT",
  "10": "ET",
  "CAT-ACC": "ET",
  SP: "BG",
};

export interface LiveCategory {
  id: string;
  code: string;
  name: string;
  slug: string;
  /** Products in this category. */
  products: number;
  /** Promotions scoped to this category. */
  promotions: number;
}

export interface MigrationPlan {
  create: { code: string; name: string; slug: string }[];
  rename: { id: string; from: string; to: string; name: string }[];
  /** Legacy rows whose products and promotions move to the target before the row is deleted. */
  moves: { sourceId: string; from: string; to: string; products: number; promotions: number }[];
  /** Legacy rows removed after the moves (or with nothing to move). */
  remove: { id: string; code: string }[];
  /** Problems that stop the migration. When this is not empty, nothing is written. */
  abort: string[];
  /** Mapped source codes that are not in the database any more (already renamed or merged). */
  alreadyMigrated: { from: string; to: string }[];
}

const officialByCode = new Map(MATRIX_CATEGORIES.map((c) => [c.code, c]));

export function planCategoryMigration(live: LiveCategory[]): MigrationPlan {
  const plan: MigrationPlan = { create: [], rename: [], moves: [], remove: [], abort: [], alreadyMigrated: [] };
  const byCode = new Map(live.map((c) => [c.code, c]));
  const slugOwner = new Map(live.map((c) => [c.slug, c.code]));

  // 1. Dictionary codes: create the missing ones, align the names of the existing ones.
  for (const entry of MATRIX_CATEGORIES) {
    const existing = byCode.get(entry.code);
    if (!existing) {
      const owner = slugOwner.get(entry.slug);
      if (owner) plan.abort.push(`slug ${entry.slug} for ${entry.code} is already used by ${owner}`);
      else {
        plan.create.push({ code: entry.code, name: entry.name, slug: entry.slug });
        slugOwner.set(entry.slug, entry.code);
      }
      continue;
    }
    if (existing.name !== entry.name) {
      plan.rename.push({ id: existing.id, from: existing.name, to: entry.name, name: entry.name });
    }
  }

  // 2. Legacy mapping: a source that is in the database moves to its target. A missing source was already handled.
  const sources = new Set<string>();
  for (const [from, to] of Object.entries(LEGACY_CATEGORY_MAP)) {
    if (!OFFICIAL_CATEGORY_CODES.has(to)) {
      plan.abort.push(`mapping ${from} -> ${to}: ${to} is not in the dictionary`);
      continue;
    }
    const source = byCode.get(from);
    if (!source) {
      plan.alreadyMigrated.push({ from, to });
      continue;
    }
    sources.add(from);
    plan.moves.push({ sourceId: source.id, from, to, products: source.products, promotions: source.promotions });
    plan.remove.push({ id: source.id, code: from });
  }

  // 3. Anything else outside the dictionary: deleted only when unused.
  for (const row of live) {
    if (OFFICIAL_CATEGORY_CODES.has(row.code) || sources.has(row.code)) continue;
    if (row.products > 0 || row.promotions > 0) {
      plan.abort.push(`legacy category ${row.code} (${row.name}) is not in the mapping and is still used by ${row.products} product(s) and ${row.promotions} promotion(s)`);
    } else {
      plan.remove.push({ id: row.id, code: row.code });
    }
  }

  return plan;
}

/** The official name for a code, or undefined when the code is not in the dictionary. */
export function officialName(code: string): string | undefined {
  return officialByCode.get(code)?.name;
}
