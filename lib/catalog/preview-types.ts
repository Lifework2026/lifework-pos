/**
 * Client-safe shapes of the Template A check result. The server fills them in (lib/catalog/import-preview.ts) and the
 * import dialog renders them. Nothing here touches the database.
 */

export type ProductPreviewStatus = "new" | "skipped";

export interface ProductPreviewRow {
  line: number;
  barcode: string | null;
  sku: string;
  name: string;
  nameTh: string | null;
  categoryCode: string;
  categoryName: string | null;
  categoryNameTh: string | null;
  colorCode: string;
  colorName: string | null;
  colorNameTh: string | null;
  size: string;
  /** Satang, so the dialog formats the amount the same way the till does. */
  priceSatang: number;
  costSatang: number | null;
  stock: number | null;
  promoTag: string | null;
  /** "skipped" when the SKU already exists and the import leaves it alone. */
  status: ProductPreviewStatus;
}

export interface ProductPreview {
  /** Header cells as they appear in the file. */
  headers: string[];
  /** Template columns that the file does not contain. */
  missingColumns: string[];
  /** Every data row in the file. */
  rowCount: number;
  /** The first rows, for display. */
  rows: ProductPreviewRow[];
}

export interface ProductPreviewSummary {
  rows: number;
  newProducts: number;
  newVariants: number;
  updatedVariants: number;
  skippedVariants: number;
  stockMovements: number;
  newSizes: number;
}

export interface ProductCheckResult {
  ok: boolean;
  issueCount?: number;
  issues?: { line: number; message: string }[];
  unknownColumns?: string[];
  message?: string;
  summary?: ProductPreviewSummary;
  preview?: ProductPreview;
}
