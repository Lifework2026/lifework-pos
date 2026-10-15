import { MATRIX_CATEGORIES, MATRIX_COLORS, type MatrixCategory, type MatrixColor } from "@/lib/catalog-matrix";

/**
 * Plans how the database follows the standard matrix. Insert and rename only: nothing is deleted, and nothing that
 * a product, variant or promotion uses loses its link, because links use IDs and a rename keeps the same row.
 *   - A matrix code that exists already is left alone.
 *   - A legacy row with the same name (ignoring case) is renamed to the matrix code.
 *   - Otherwise the matrix entry is created, unless its slug or name belongs to another record: then it is a conflict.
 * Pure: the caller reads the rows and writes the plan.
 */

export interface SyncCategory {
  id: string;
  code: string;
  name: string;
  slug: string;
}

export interface SyncColor {
  id: string;
  code: string;
  name: string;
}

export interface SyncRename {
  id: string;
  from: string;
  to: string;
  name: string;
}

export interface SyncPlan {
  renameCategories: SyncRename[];
  createCategories: MatrixCategory[];
  renameColors: SyncRename[];
  createColors: MatrixColor[];
  /** Matrix codes that are already in place. */
  unchanged: string[];
  /** Matrix entries that cannot be written without a clash. Nothing is written for these. */
  conflicts: string[];
}

export function planMatrixSync(
  categories: SyncCategory[],
  colors: SyncColor[],
  matrix: { categories: MatrixCategory[]; colors: MatrixColor[] } = { categories: MATRIX_CATEGORIES, colors: MATRIX_COLORS },
): SyncPlan {
  const plan: SyncPlan = {
    renameCategories: [],
    createCategories: [],
    renameColors: [],
    createColors: [],
    unchanged: [],
    conflicts: [],
  };

  // Categories. A legacy row can only be renamed once, and only if it does not already hold a matrix code.
  const matrixCategoryCodes = new Set(matrix.categories.map((c) => c.code));
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));
  const claimedCategories = new Set<string>();
  const takenSlugs = new Set(categories.map((c) => c.slug));
  for (const entry of matrix.categories) {
    if (categoryByCode.has(entry.code)) {
      plan.unchanged.push(`category ${entry.code}`);
      continue;
    }
    const legacy = categories.find(
      (c) => !claimedCategories.has(c.id) && !matrixCategoryCodes.has(c.code) && c.name.toLowerCase() === entry.name.toLowerCase(),
    );
    if (legacy) {
      claimedCategories.add(legacy.id);
      plan.renameCategories.push({ id: legacy.id, from: legacy.code, to: entry.code, name: legacy.name });
      continue;
    }
    if (takenSlugs.has(entry.slug)) {
      plan.conflicts.push(`category ${entry.code} ${entry.name}: slug ${entry.slug} is used by another category`);
      continue;
    }
    takenSlugs.add(entry.slug);
    plan.createCategories.push(entry);
  }

  // Colours. Names are unique, so a name that another code holds is a clash unless that row can be renamed.
  const matrixColorCodes = new Set(matrix.colors.map((c) => c.code));
  const colorByCode = new Map(colors.map((c) => [c.code, c]));
  const claimedColors = new Set<string>();
  const colorNames = new Map(colors.map((c) => [c.name.toLowerCase(), c]));
  for (const entry of matrix.colors) {
    if (colorByCode.has(entry.code)) {
      plan.unchanged.push(`colour ${entry.code}`);
      continue;
    }
    const sameName = colorNames.get(entry.name.toLowerCase());
    if (sameName && !claimedColors.has(sameName.id) && !matrixColorCodes.has(sameName.code)) {
      claimedColors.add(sameName.id);
      plan.renameColors.push({ id: sameName.id, from: sameName.code, to: entry.code, name: sameName.name });
      continue;
    }
    if (sameName) {
      plan.conflicts.push(`colour ${entry.code} ${entry.name}: the name is already used by ${sameName.code}`);
      continue;
    }
    plan.createColors.push(entry);
  }

  return plan;
}
