import type { ImportPlan, ImportRow } from "@/lib/catalog/import";
import type { ProductPreview, ProductPreviewRow } from "@/lib/catalog/preview-types";

/**
 * Builds what the visual preview shows, from the parsed rows and the plan. Pure: the caller reads the master names
 * from the database and passes them in. Read-only by design.
 */

/** Rows sent back for display. The row count still covers every row in the file. */
export const PREVIEW_ROW_LIMIT = 300;

function columnKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Header cells of the file, and the template columns that none of them match. */
export function describeColumns(table: string[][], template: string[]): { headers: string[]; missingColumns: string[] } {
  const headers = (table[0] ?? []).map((cell) => cell.trim()).filter((cell) => cell !== "");
  const present = new Set(headers.map(columnKey));
  return { headers, missingColumns: template.filter((column) => !present.has(columnKey(column))) };
}

export interface MasterName {
  code: string;
  name: string;
  nameTh: string | null;
}

export function buildProductPreview(input: {
  rows: ImportRow[];
  plan: Pick<ImportPlan, "skipped">;
  headers: string[];
  missingColumns: string[];
  categories: MasterName[];
  colors: MasterName[];
}): ProductPreview {
  const categoryBy = new Map(input.categories.map((c) => [c.code, c]));
  const colorBy = new Map(input.colors.map((c) => [c.code, c]));
  const skippedLines = new Set(input.plan.skipped.map((s) => s.line));

  const rows: ProductPreviewRow[] = input.rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => {
    const category = categoryBy.get(row.categoryCode);
    const color = colorBy.get(row.colorCode);
    return {
      line: row.line,
      barcode: row.barcode,
      sku: row.sku,
      name: row.name,
      nameTh: row.nameTh,
      categoryCode: row.categoryCode,
      categoryName: category?.name ?? null,
      categoryNameTh: category?.nameTh ?? null,
      colorCode: row.colorCode,
      colorName: color?.name ?? null,
      colorNameTh: color?.nameTh ?? null,
      size: row.size,
      priceSatang: row.priceSatang,
      costSatang: row.costSatang,
      stock: row.stock,
      promoTag: row.promoTag,
      status: skippedLines.has(row.line) ? "skipped" : "new",
    };
  });

  return {
    headers: input.headers,
    missingColumns: input.missingColumns,
    rowCount: input.rows.length,
    rows,
  };
}
