// Excel bulk actions: templates, the master-data codes, the importers and the sample-row guard.
// Run with: npx tsx tests/excel.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildTemplateWorkbook, TEMPLATES, type MasterData } from "../lib/excel-templates";
import { parsePriceTable } from "../lib/catalog/price-import";
import { movementFor, parseStockTable } from "../lib/catalog/stock-import";
import { parseImportTable, planImport, TEMPLATE_HEADER, type ImportRow } from "../lib/catalog/import";

const require = createRequire(__filename);
const ExcelJS = require("exceljs");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const MASTER: MasterData = {
  categories: [
    { code: "CAT-SHIRT", name: "Shirts", nameTh: "เสื้อ" },
    { code: "CAT-PANT", name: "Pants", nameTh: "กางเกง" },
  ],
  colors: [
    { code: "COL-BLK", name: "Black", nameTh: "ดำ" },
    { code: "COL-WHT", name: "White", nameTh: "ขาว" },
  ],
};

async function readWorkbook(type: "A" | "B" | "C", master?: MasterData) {
  const buffer = await buildTemplateWorkbook(type, master);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/** A stand-in for the Prisma client: returns fixed master data and no existing products. */
function fakeDb(): Parameters<typeof planImport>[0] {
  const empty = async () => [];
  return {
    productVariant: { findMany: empty },
    product: { findMany: empty },
    size: { findMany: empty },
    category: { findMany: async () => [{ id: "cat-shirt", code: "CAT-SHIRT", name: "Shirts" }] },
    color: { findMany: async () => [{ id: "col-blk", code: "COL-BLK", name: "Black" }] },
  } as unknown as Parameters<typeof planImport>[0];
}

const options = { onExisting: "skip" as const, applyStock: false };
function row(overrides: Partial<ImportRow>): ImportRow {
  return {
    line: 2,
    sku: "LW-1",
    name: "Tee",
    nameTh: null,
    categoryCode: "CAT-SHIRT",
    colorCode: "COL-BLK",
    size: "M",
    priceSatang: 39_000,
    costSatang: null,
    stock: 0,
    barcode: null,
    promoTag: null,
    brand: null,
    description: null,
    ...overrides,
  };
}

(async () => {
  // ------------------------------------------------------------ templates
  await test("template A: row 1 is the exact header, row 2 is the example in the same order", async () => {
    const wb = await readWorkbook("A", MASTER);
    const data = wb.getWorksheet("Data");
    assert.deepEqual(data.getRow(1).values.slice(1), TEMPLATE_HEADER);
    const example = data.getRow(2).values.slice(1);
    assert.equal(example.length, TEMPLATE_HEADER.length);
    assert.equal(example[0], "EXAMPLE-0000001");
    assert.equal(example[TEMPLATE_HEADER.indexOf("Category_Code")], "CAT-SHIRT", "example uses a live category code");
    assert.equal(example[TEMPLATE_HEADER.indexOf("Color_Code")], "COL-BLK", "example uses a live colour code");
  });

  await test("template A lists the master data codes on its own sheet", async () => {
    const wb = await readWorkbook("A", MASTER);
    const codes = wb.getWorksheet("Master_Data_Codes");
    assert.ok(codes, "Master_Data_Codes sheet");
    const rows: unknown[][] = [];
    codes.eachRow((r: { values: unknown[] }, index: number) => {
      if (index > 1) rows.push(r.values.slice(1));
    });
    assert.deepEqual(rows[0], ["Category", "CAT-SHIRT", "Shirts", "เสื้อ"]);
    assert.ok(rows.some((r) => r[0] === "Color" && r[1] === "COL-BLK"));
    assert.equal(rows.length, MASTER.categories.length + MASTER.colors.length);
  });

  await test("template B and C: headers match the importers, and row 2 is an example", async () => {
    const b = await readWorkbook("B");
    assert.deepEqual(b.getWorksheet("Data").getRow(1).values.slice(1), ["Barcode", "New_Price", "Promo_Tag"]);
    assert.equal(b.getWorksheet("Data").getRow(2).getCell(1).value, "EXAMPLE-0000001");
    const c = await readWorkbook("C");
    assert.deepEqual(c.getWorksheet("Data").getRow(1).values.slice(1), ["Barcode", "Quantity_Change", "Reason"]);
    assert.equal(c.getWorksheet("Data").getRow(2).getCell(3).value, "Damage");
  });

  await test("each template is a real .xlsx file (zip signature) and has instructions", async () => {
    for (const type of ["A", "B", "C"] as const) {
      const buffer = await buildTemplateWorkbook(type, MASTER);
      assert.equal(buffer[0], 0x50);
      assert.equal(buffer[1], 0x4b);
    }
    assert.ok(TEMPLATES.A.instructions.some((line) => /Category_Code/.test(line)));
    assert.ok(TEMPLATES.A.instructions.length >= 5 && TEMPLATES.B.instructions.length >= 4 && TEMPLATES.C.instructions.length >= 5);
  });

  // ------------------------------------------------------------ sample guard
  await test("the example row is refused by every importer, so an unedited template cannot change stock", () => {
    const a = parseImportTable([TEMPLATE_HEADER, ["EXAMPLE-0000001", "EXAMPLE-TEE-M", "", "Example Tee", "CAT-SHIRT", "COL-BLK", "M", "390", "180", "10", "HOT"]]);
    assert.ok(a.issues.some((i) => /example row/.test(i.message)));
    assert.equal(a.rows.length, 0);
    const b = parsePriceTable([["Barcode", "New_Price", "Promo_Tag"], ["EXAMPLE-0000001", "350", "SALE"]]);
    assert.ok(b.issues.some((i) => /example row/.test(i.message)));
    const c = parseStockTable([["Barcode", "Quantity_Change", "Reason"], ["EXAMPLE-0000001", "-2", "Damage"]]);
    assert.ok(c.issues.some((i) => /example row/.test(i.message)));
  });

  // ------------------------------------------------------------ template A: codes
  await test("template A reads the cost and promo tag and resolves codes to their master record", () => {
    const result = parseImportTable([
      TEMPLATE_HEADER,
      ["LW265TS99035XL", "LW-TEE-M", "เสื้อยืด", "Cotton Tee", "CAT-SHIRT", "COL-BLK", "M", "390", "180.50", "10", "HOT"],
    ]);
    assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
    const r = result.rows[0];
    assert.equal(r.name, "Cotton Tee");
    assert.equal(r.categoryCode, "CAT-SHIRT");
    assert.equal(r.colorCode, "COL-BLK");
    assert.equal(r.costSatang, 18050);
    assert.equal(r.promoTag, "HOT");
    assert.equal(r.stock, 10);
  });

  await test("template A rejects a bad cost and an over-long promo tag", () => {
    const result = parseImportTable([
      ["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price", "Cost", "Promo_Tag"],
      ["LW-1", "Tee", "CAT-SHIRT", "COL-BLK", "M", "390", "1.234", "X".repeat(31)],
    ]);
    assert.ok(result.issues.some((i) => /Cost/.test(i.message)));
    assert.ok(result.issues.some((i) => /Promo_Tag/.test(i.message)));
  });

  await test("template A: a category code that is not in the database is rejected, naming the code", async () => {
    const plan = await planImport(fakeDb(), [row({ line: 2, categoryCode: "CAT-01" })], options);
    assert.equal(plan.variants.length, 0);
    assert.ok(plan.issues.some((i) => i.line === 2 && i.message === "Category Code 'CAT-01' not found. Check the Master_Data_Codes sheet."), JSON.stringify(plan.issues));
  });

  await test("template A: a colour code that is not in the database is rejected, naming the code", async () => {
    const plan = await planImport(fakeDb(), [row({ line: 3, colorCode: "COL-XYZ" })], options);
    assert.equal(plan.variants.length, 0);
    assert.ok(plan.issues.some((i) => i.line === 3 && i.message === "Color Code 'COL-XYZ' not found. Check the Master_Data_Codes sheet."));
  });

  await test("template A: a valid code row is planned with the colour id and name", async () => {
    const plan = await planImport(fakeDb(), [row({ line: 2 })], options);
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.variants.length, 1);
    assert.equal(plan.variants[0].colorId, "col-blk");
    assert.equal(plan.variants[0].colorName, "Black");
    assert.equal(plan.products[0].categoryId, "cat-shirt");
  });

  await test("template A: one bad code does not stop the valid rows, which are still planned", async () => {
    const plan = await planImport(fakeDb(), [row({ line: 2, sku: "LW-1" }), row({ line: 3, sku: "LW-2", categoryCode: "CAT-99" })], options);
    assert.equal(plan.variants.length, 1);
    assert.equal(plan.variants[0].sku, "LW-1");
    assert.equal(plan.issues.length, 1);
    assert.equal(plan.issues[0].line, 3);
  });

  // ------------------------------------------------------------ template B
  await test("template B: blank cells mean keep, a row with nothing to change is refused", () => {
    const result = parsePriceTable([
      ["Barcode", "New_Price", "Promo_Tag"],
      ["LW265TS99035XL", "350", ""],
      ["LW265TS99035XM", "", "SALE"],
      ["LW265TS99035XN", "", ""],
    ]);
    assert.deepEqual(result.rows[0], { line: 2, barcode: "LW265TS99035XL", priceSatang: 35000, promoTag: null });
    assert.deepEqual(result.rows[1], { line: 3, barcode: "LW265TS99035XM", priceSatang: null, promoTag: "SALE" });
    assert.ok(result.issues.some((i) => i.line === 4 && /Nothing to change/.test(i.message)));
  });

  await test("template B: duplicate barcodes, bad prices and missing columns are caught", () => {
    const dup = parsePriceTable([
      ["Barcode", "New_Price"],
      ["LW265TS99035XL", "350"],
      ["LW265TS99035XL", "360"],
    ]);
    assert.ok(dup.issues.some((i) => i.line === 3 && /already on line 2/.test(i.message)));
    const price = parsePriceTable([["Barcode", "New_Price"], ["LW265TS99035XL", "12.345"]]);
    assert.ok(price.issues.some((i) => /at most 2 decimals/.test(i.message)));
    const missing = parsePriceTable([["Barcode", "Note"], ["LW265TS99035XL", "x"]]);
    assert.ok(missing.issues.some((i) => /New_Price|Promo_Tag/.test(i.message)));
  });

  // ------------------------------------------------------------ template C
  await test("template C: each reason fixes the sign of its quantity", () => {
    const result = parseStockTable([
      ["Barcode", "Quantity_Change", "Reason"],
      ["LW265TS99035XL", "5", "Restock"],
      ["LW265TS99035XM", "-2", "Damage"],
      ["LW265TS99035XN", "-3", "Count"],
      ["LW265TS99035XO", "-1", "Restock"],
      ["LW265TS99035XP", "2", "Damage"],
      ["LW265TS99035XQ", "0", "Count"],
      ["LW265TS99035XR", "1", "Sold"],
    ]);
    assert.equal(result.rows.length, 3, JSON.stringify(result.rows));
    assert.ok(result.issues.some((i) => i.line === 5 && /Restock must add/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 6 && /Damage must remove/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 7 && /must not be zero/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 8 && /Reason must be/.test(i.message)));
  });

  await test("template C: reasons map to the ledger types the reports expect", () => {
    assert.deepEqual(movementFor("Restock"), { type: "STOCK_IN", reasonCode: null });
    assert.deepEqual(movementFor("Damage"), { type: "ADJUSTMENT", reasonCode: "DAMAGED" });
    assert.deepEqual(movementFor("Count"), { type: "ADJUSTMENT", reasonCode: "COUNT_CORRECTION" });
  });

  await test("template C: quantities must be whole numbers within the limit", () => {
    const result = parseStockTable([
      ["Barcode", "Quantity_Change", "Reason"],
      ["LW265TS99035XL", "1.5", "Count"],
      ["LW265TS99035XM", "200000", "Restock"],
    ]);
    assert.ok(result.issues.some((i) => i.line === 2 && /whole number/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 3 && /too large/.test(i.message)));
  });

  console.log(`\n${passed} Excel bulk-action groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
