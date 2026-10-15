/**
 * The three bulk-action spreadsheets. Each workbook has two sheets:
 *   Data          row 1 holds the headers, row 2 is an example in the exact format. Replace or delete row 2.
 *   Instructions  what each column means and what is accepted.
 * The example barcode and SKU start with EXAMPLE-, and every importer refuses such a row, so an unedited sample
 * can never create or change stock.
 */

import { MAX_PRICE_ROWS, PRICE_TEMPLATE_HEADER } from "@/lib/catalog/price-import";
import { MAX_STOCK_ROWS, STOCK_TEMPLATE_HEADER } from "@/lib/catalog/stock-import";

export type TemplateType = "A" | "B" | "C";

export const NEW_PRODUCT_HEADER = ["Barcode", "SKU", "Name_TH", "Name_EN", "Category", "Size", "Price", "Cost", "Initial_Stock", "Promo_Tag"];

interface TemplateSpec {
  title: string;
  file: string;
  header: string[];
  example: string[];
  /** Zero-based columns Excel must keep as text (barcodes, SKUs). */
  textColumns: number[];
  widths: number[];
  instructions: string[];
}

export const TEMPLATES: Record<TemplateType, TemplateSpec> = {
  A: {
    title: "A. New products",
    file: "lifework-template-A-new-products.xlsx",
    header: NEW_PRODUCT_HEADER,
    example: ["EXAMPLE-0000001", "EXAMPLE-TEE-M", "เสื้อยืดตัวอย่าง", "Example Tee", "Shirts", "M", "390", "180", "10", "HOT"],
    textColumns: [0, 1],
    widths: [18, 18, 22, 22, 14, 8, 10, 10, 14, 14],
    instructions: [
      "Use this template to create products that are not in the system yet. One row per size and colour.",
      "Barcode: the code printed on the item or label. Letters, digits and - . / _ only, 4 to 40 characters. Leave blank to have the system create one.",
      "SKU: the stock-keeping code, letters, digits, dots, dashes or underscores. Leave blank to have one generated.",
      "Name_TH / Name_EN: the product name in Thai and in English. Rows with the same name are one product.",
      "Category: an existing category name, or a new one. New categories are created automatically.",
      "Size: for example S, M, L, 30, Free Size. Sizes that are new are added to the size list.",
      "Price: the selling price in baht, VAT included, up to 2 decimals.",
      "Cost: the unit cost in baht. Optional.",
      "Initial_Stock: the units on hand when the product is created. Written to the stock history as an opening entry.",
      "Promo_Tag: a short badge shown on the till, for example SALE, HOT or BUY 1 GET 1. Optional.",
      `Up to 2000 rows per file. Row 2 is an example: replace it or delete it. A row that still starts with EXAMPLE- is refused.`,
    ],
  },
  B: {
    title: "B. Price and promo update",
    file: "lifework-template-B-price-promo.xlsx",
    header: PRICE_TEMPLATE_HEADER,
    example: ["EXAMPLE-0000001", "350", "SALE"],
    textColumns: [0],
    widths: [18, 12, 16],
    instructions: [
      "Use this template to change prices and promo tags of existing products. Rows are matched by Barcode.",
      "Barcode (key): must already exist in the system. A barcode that does not exist is refused, so nothing is created here.",
      "New_Price: the new selling price in baht, VAT included. Leave blank to keep the current price.",
      "Promo_Tag: the new tag for the product. Leave blank to keep the current tag. The tag applies to the whole product.",
      "A row with both cells blank is refused: there is nothing to change.",
      `Up to ${MAX_PRICE_ROWS} rows per file. Every change is recorded in the audit log. Row 2 is an example: replace or delete it.`,
    ],
  },
  C: {
    title: "C. Stock in and out",
    file: "lifework-template-C-stock.xlsx",
    header: STOCK_TEMPLATE_HEADER,
    example: ["EXAMPLE-0000001", "-2", "Damage"],
    textColumns: [0],
    widths: [18, 18, 14],
    instructions: [
      "Use this template to receive stock and to correct it in bulk. Each row is one movement, written to the stock history with its reason.",
      "Barcode (key): must already exist in the system.",
      "Quantity_Change: whole units. Use a positive number to add, a negative number to remove.",
      "Reason Restock: receives a shipment. Quantity_Change must be above 0.",
      "Reason Damage: removes damaged units. Quantity_Change must be below 0.",
      "Reason Count: corrects stock after a physical count. Any non-zero Quantity_Change, positive or negative.",
      "If any row would take stock below zero, the whole file is refused and nothing is saved.",
      `Up to ${MAX_STOCK_ROWS} rows per file. Row 2 is an example: replace or delete it.`,
    ],
  },
};

export function isTemplateType(value: string | null | undefined): value is TemplateType {
  return value === "A" || value === "B" || value === "C";
}

/** Builds the .xlsx for one template. Row 1 is the header, row 2 the example, and a second sheet explains the columns. */
export async function buildTemplateWorkbook(type: TemplateType): Promise<Buffer> {
  const spec = TEMPLATES[type];
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Lifework POS";
  workbook.created = new Date();

  const data = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  data.columns = spec.header.map((title, index) => ({
    header: title,
    key: `c${index}`,
    width: spec.widths[index] ?? 16,
    style: spec.textColumns.includes(index) ? { numFmt: "@" } : {},
  }));
  const headerRow = data.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const exampleRow = data.addRow(spec.example);
  exampleRow.font = { italic: true, color: { argb: "FF6B7280" } };

  const notes = workbook.addWorksheet("Instructions");
  notes.getColumn(1).width = 110;
  notes.addRow([spec.title]).font = { bold: true, size: 13 };
  notes.addRow([""]);
  for (const line of spec.instructions) {
    const row = notes.addRow([line]);
    row.alignment = { wrapText: true, vertical: "top" };
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

