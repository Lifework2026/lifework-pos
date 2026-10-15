/**
 * The six bulk spreadsheets. Each workbook has two or three sheets:
 *   Data          row 1 holds the headers, row 2 is an example in the exact format. Replace or delete row 2.
 *   Instructions  what each column means and what is accepted.
 *   Master_Data_Codes (Template A only) every current category and colour with its code.
 * Barcode, SKU, Category_Code, Color_Code and Phone_Number are formatted as Text down to the last row an import
 * accepts, so Excel keeps leading zeros such as 01 or 0812345678. The example barcode and SKU start with EXAMPLE-,
 * and every importer refuses such a row, so an unedited sample can never create or change stock.
 */

import type { Prisma } from "@prisma/client";
import type { Worksheet } from "exceljs";
import { MAX_PRICE_ROWS, PRICE_TEMPLATE_HEADER } from "@/lib/catalog/price-import";
import { MAX_STOCK_ROWS, STOCK_TEMPLATE_HEADER } from "@/lib/catalog/stock-import";
import { TEMPLATE_HEADER } from "@/lib/catalog/import";
import { CATEGORY_TEMPLATE_HEADER, COLOR_TEMPLATE_HEADER, MAX_MASTER_ROWS } from "@/lib/catalog/master-import";
import { MEMBER_TEMPLATE_HEADER, MAX_MEMBER_ROWS } from "@/lib/members/import";
import { prisma } from "@/lib/prisma";
import { TEXT_COLUMNS } from "@/lib/text-columns";

export type TemplateType = "A" | "B" | "C" | "D" | "E" | "F";

export const NEW_PRODUCT_HEADER = TEMPLATE_HEADER;

/** Header row plus the largest import (2000 rows), so the text format covers every row a file can hold. */
const TEXT_LAST_ROW = 2001;

const TEXT_NOTE =
  "Barcode, SKU, Category_Code, Color_Code and Phone_Number are text. Keep their format as Text and type 01, not 1, so leading zeros are kept.";

/** The master data a template lists, read from the database. */
export interface MasterData {
  categories: { code: string; name: string; nameTh: string | null }[];
  colors: { code: string; name: string; nameTh: string | null }[];
}

/** Reads the current categories and colours, ordered by code, for Template A. */
export async function loadMasterData(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<MasterData> {
  const [categories, colors] = await Promise.all([
    db.category.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, nameTh: true } }),
    db.color.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { code: true, name: true, nameTh: true } }),
  ]);
  return { categories, colors };
}

interface TemplateSpec {
  title: string;
  file: string;
  header: string[];
  /** Row 2. For Template A the codes are taken from the live master data. */
  example: (master: MasterData) => string[];
  widths: number[];
  instructions: string[];
}

export const TEMPLATES: Record<TemplateType, TemplateSpec> = {
  A: {
    title: "A. New products",
    file: "lifework-template-A-new-products.xlsx",
    header: NEW_PRODUCT_HEADER,
    example: (master) => [
      "EXAMPLE-0000001",
      "EXAMPLE-TEE-M",
      "เสื้อยืดตัวอย่าง",
      "Example Tee",
      master.categories[0]?.code ?? "00",
      master.colors[0]?.code ?? "BK",
      "M",
      "390",
      "180",
      "10",
      "HOT",
    ],
    widths: [18, 18, 22, 22, 16, 14, 8, 10, 10, 14, 14],
    instructions: [
      "Use this template to create products that are not in the system yet. One row per size and colour.",
      "Category_Code (required): the code of an existing category, copied exactly from the Master_Data_Codes sheet, for example 00. Categories are not created by this import.",
      "Color_Code (required): the code of an existing colour, copied exactly from the Master_Data_Codes sheet, for example BK. Colours are not created by this import.",
      "A code that is not in the master data is refused with a message naming the code. Fix the code or add the category or colour first, then import again.",
      "Barcode: the code printed on the item or label. Letters, digits and - . / _ only, 4 to 40 characters. Leave blank to have the system create one.",
      "SKU: the stock-keeping code, letters, digits, dots, dashes or underscores.",
      "Name_TH / Name_EN: the product name in Thai and in English. Rows with the same name are one product, and must use the same category.",
      "Size: for example S, M, L, 30, Free Size. Sizes that are new are added to the size list.",
      "Price: the selling price in baht, VAT included, up to 2 decimals.",
      "Cost: the unit cost in baht. Optional.",
      "Initial_Stock: the units on hand when the product is created. Written to the stock history as an opening entry.",
      "Promo_Tag: a short badge shown on the till, for example SALE, HOT or BUY 1 GET 1. Optional.",
      "Up to 2000 rows per file. Row 2 is an example: replace it or delete it. A row that still starts with EXAMPLE- is refused.",
      TEXT_NOTE,
    ],
  },
  B: {
    title: "B. Price and promo update",
    file: "lifework-template-B-price-promo.xlsx",
    header: PRICE_TEMPLATE_HEADER,
    example: () => ["EXAMPLE-0000001", "350", "SALE"],
    widths: [18, 12, 16],
    instructions: [
      "Use this template to change prices and promo tags of existing products. Rows are matched by Barcode.",
      "Barcode (key): must already exist in the system. A barcode that does not exist is refused, so nothing is created here.",
      "New_Price: the new selling price in baht, VAT included. Leave blank to keep the current price.",
      "Promo_Tag: the new tag for the product. Leave blank to keep the current tag. The tag applies to the whole product.",
      "A row with both cells blank is refused: there is nothing to change.",
      `Up to ${MAX_PRICE_ROWS} rows per file. Every change is recorded in the audit log. Row 2 is an example: replace or delete it.`,
      TEXT_NOTE,
    ],
  },
  C: {
    title: "C. Stock in and out",
    file: "lifework-template-C-stock.xlsx",
    header: STOCK_TEMPLATE_HEADER,
    example: () => ["EXAMPLE-0000001", "-2", "Damage"],
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
      TEXT_NOTE,
    ],
  },
  D: {
    title: "D. Categories",
    file: "lifework-template-D-categories.xlsx",
    header: CATEGORY_TEMPLATE_HEADER,
    example: () => ["00", "EXAMPLE Short-Sleeved T-Shirt"],
    widths: [18, 30],
    instructions: [
      "Use this template to create categories and rename them in bulk. Rows are matched by Category_Code.",
      "Category_Code (key): 2 to 20 letters or digits, upper case, for example 00 for Short-Sleeved T-Shirt. It is unique and cannot be shared.",
      "Category_Name: the category name in English. If the code already exists, its name is updated. If not, a new category is created.",
      "A name that another category already uses is refused, so two codes never share a name.",
      "Products keep their category when a category is renamed. Categories are never deleted by this import.",
      `Up to ${MAX_MASTER_ROWS} rows per file. Row 2 is an example: replace or delete it. A row whose name starts with EXAMPLE is refused.`,
      TEXT_NOTE,
    ],
  },
  E: {
    title: "E. Colours",
    file: "lifework-template-E-colours.xlsx",
    header: COLOR_TEMPLATE_HEADER,
    example: () => ["BK", "EXAMPLE Black"],
    widths: [18, 30],
    instructions: [
      "Use this template to create colours and rename them in bulk. Rows are matched by Color_Code.",
      "Color_Code (key): 2 to 20 letters or digits, upper case, for example BK for Black or WH for White. It is unique and cannot be shared.",
      "Color_Name: the colour name in English. If the code already exists, the colour is renamed and every product that uses it shows the new name.",
      "A name that another colour already uses is refused.",
      `Up to ${MAX_MASTER_ROWS} rows per file. Row 2 is an example: replace or delete it. A row whose name starts with EXAMPLE is refused.`,
      TEXT_NOTE,
    ],
  },
  F: {
    title: "F. Members",
    file: "lifework-template-F-members.xlsx",
    header: MEMBER_TEMPLATE_HEADER,
    example: () => ["0800000000", "EXAMPLE", "Member", "0"],
    widths: [16, 18, 18, 10],
    instructions: [
      "Use this template to add members and update their names and points in bulk. Rows are matched by Phone_Number.",
      "Phone_Number (key): 9 or 10 digits starting with 0. Dashes and spaces are ignored. A phone that exists updates that member; a new phone creates one.",
      "First_Name: required. Last_Name: optional. Names are joined with a space.",
      "Points: the point balance to set for the member. It replaces the current balance, it does not add to it. Leave blank to keep the current balance; a new member starts at 0.",
      "Every change is written to the audit log with the old and new values.",
      `Up to ${MAX_MEMBER_ROWS} rows per file. Row 2 is an example: replace or delete it. A row whose First_Name is EXAMPLE is refused.`,
      TEXT_NOTE,
    ],
  },
};

export function isTemplateType(value: string | null | undefined): value is TemplateType {
  return value !== undefined && value !== null && ["A", "B", "C", "D", "E", "F"].includes(value);
}

/** Example row for a template, with the live codes for Template A. */
export function templateExample(type: TemplateType, master: MasterData): string[] {
  return TEMPLATES[type].example(master);
}

/** Zero-based indexes of the header cells that must stay text. Matched by name, so column order does not matter. */
export function textColumnIndexes(header: string[]): number[] {
  const indexes: number[] = [];
  header.forEach((title, index) => {
    if ((TEXT_COLUMNS as readonly string[]).indexOf(title) >= 0) indexes.push(index);
  });
  return indexes;
}

/** Sets the Text format on each column, and on each cell down to the last row an import accepts. */
function formatAsText(sheet: Worksheet, columns: number[]): void {
  for (const index of columns) {
    sheet.getColumn(index + 1).numFmt = "@";
    for (let row = 2; row <= TEXT_LAST_ROW; row += 1) {
      sheet.getCell(row, index + 1).numFmt = "@";
    }
  }
}

/**
 * Builds the .xlsx for one template. Template A also gets the Master_Data_Codes sheet, listing every category and
 * colour with its code. The master data is read from the database when the file is made.
 */
export async function buildTemplateWorkbook(type: TemplateType, master?: MasterData): Promise<Buffer> {
  const spec = TEMPLATES[type];
  const masterData = type === "A" ? (master ?? (await loadMasterData())) : { categories: [], colors: [] };
  const textIndexes = textColumnIndexes(spec.header);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Lifework POS";
  workbook.created = new Date();

  const data = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  data.columns = spec.header.map((title, index) => ({
    header: title,
    key: `c${index}`,
    width: spec.widths[index] ?? 16,
    style: textIndexes.indexOf(index) >= 0 ? { numFmt: "@" } : {},
  }));
  const headerRow = data.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const exampleRow = data.addRow(spec.example(masterData));
  exampleRow.font = { italic: true, color: { argb: "FF6B7280" } };
  formatAsText(data, textIndexes);

  if (type === "A") {
    const codes = workbook.addWorksheet("Master_Data_Codes", { views: [{ state: "frozen", ySplit: 1 }] });
    codes.columns = [
      { header: "Type", key: "type", width: 12 },
      { header: "Code", key: "code", width: 16 },
      { header: "Name_EN", key: "name", width: 24 },
      { header: "Name_TH", key: "nameTh", width: 24 },
    ];
    codes.getRow(1).font = { bold: true };
    codes.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    for (const category of masterData.categories) {
      codes.addRow({ type: "Category", code: category.code, name: category.name, nameTh: category.nameTh ?? "" });
    }
    for (const color of masterData.colors) {
      codes.addRow({ type: "Color", code: color.code, name: color.name, nameTh: color.nameTh ?? "" });
    }
    if (masterData.categories.length === 0 && masterData.colors.length === 0) {
      codes.addRow({ type: "", code: "", name: "No categories or colours yet. Add them in Back-Office first.", nameTh: "" });
    }
    // Column 2 is the code. Text format keeps 01 and 00 as typed.
    formatAsText(codes, [1]);
  }

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
