// Excel bulk actions: templates, the price and stock importers, and the sample-row guard. Run with: npx tsx tests/excel.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildTemplateWorkbook, NEW_PRODUCT_HEADER, TEMPLATES } from "../lib/excel-templates";
import { parsePriceTable } from "../lib/catalog/price-import";
import { movementFor, parseStockTable } from "../lib/catalog/stock-import";
import { parseImportTable } from "../lib/catalog/import";

const require = createRequire(__filename);
const ExcelJS = require("exceljs");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

async function readWorkbook(type: "A" | "B" | "C") {
  const buffer = await buildTemplateWorkbook(type);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

(async () => {
  // ------------------------------------------------------------ templates
  await test("template A: row 1 is the exact header, row 2 is the example in the same order", async () => {
    const wb = await readWorkbook("A");
    const data = wb.getWorksheet("Data");
    const header = data.getRow(1).values.slice(1);
    assert.deepEqual(header, NEW_PRODUCT_HEADER);
    const example = data.getRow(2).values.slice(1);
    assert.equal(example.length, NEW_PRODUCT_HEADER.length);
    assert.equal(example[0], "EXAMPLE-0000001");
    assert.ok(wb.getWorksheet("Instructions"), "instructions sheet");
  });

  await test("template B and C: headers match the importers, and row 2 is an example", async () => {
    const b = await readWorkbook("B");
    assert.deepEqual(b.getWorksheet("Data").getRow(1).values.slice(1), ["Barcode", "New_Price", "Promo_Tag"]);
    assert.equal(b.getWorksheet("Data").getRow(2).getCell(1).value, "EXAMPLE-0000001");
    const c = await readWorkbook("C");
    assert.deepEqual(c.getWorksheet("Data").getRow(1).values.slice(1), ["Barcode", "Quantity_Change", "Reason"]);
    assert.equal(c.getWorksheet("Data").getRow(2).getCell(3).value, "Damage");
  });

  await test("each template is a real .xlsx file (zip signature)", async () => {
    for (const type of ["A", "B", "C"] as const) {
      const buffer = await buildTemplateWorkbook(type);
      assert.equal(buffer[0], 0x50);
      assert.equal(buffer[1], 0x4b);
    }
    assert.ok(TEMPLATES.A.instructions.length >= 5 && TEMPLATES.B.instructions.length >= 4 && TEMPLATES.C.instructions.length >= 5);
  });

  // ------------------------------------------------------------ sample guard
  await test("the example row is refused by every importer, so an unedited template cannot change stock", () => {
    const a = parseImportTable([
      ["Barcode", "SKU", "Name_TH", "Name_EN", "Category", "Size", "Price", "Cost", "Initial_Stock", "Promo_Tag"],
      ["EXAMPLE-0000001", "EXAMPLE-TEE-M", "", "Example Tee", "Shirts", "M", "390", "180", "10", "HOT"],
    ]);
    assert.ok(a.issues.some((i) => /example row/.test(i.message)));
    assert.equal(a.rows.length, 0);
    const b = parsePriceTable([["Barcode", "New_Price", "Promo_Tag"], ["EXAMPLE-0000001", "350", "SALE"]]);
    assert.ok(b.issues.some((i) => /example row/.test(i.message)));
    const c = parseStockTable([["Barcode", "Quantity_Change", "Reason"], ["EXAMPLE-0000001", "-2", "Damage"]]);
    assert.ok(c.issues.some((i) => /example row/.test(i.message)));
  });

  // ------------------------------------------------------------ template A: cost and promo tag
  await test("template A columns are read: Name_EN, Cost, Initial_Stock and Promo_Tag", () => {
    const result = parseImportTable([
      ["Barcode", "SKU", "Name_TH", "Name_EN", "Category", "Size", "Price", "Cost", "Initial_Stock", "Promo_Tag"],
      ["LW265TS99035XL", "LW-TEE-M", "เสื้อยืด", "Cotton Tee", "Shirts", "M", "390", "180.50", "10", "HOT"],
    ]);
    assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
    const row = result.rows[0];
    assert.equal(row.name, "Cotton Tee");
    assert.equal(row.nameTh, "เสื้อยืด");
    assert.equal(row.costSatang, 18050);
    assert.equal(row.promoTag, "HOT");
    assert.equal(row.stock, 10);
  });

  await test("template A rejects a bad cost and an over-long promo tag", () => {
    const result = parseImportTable([
      ["SKU", "Name", "Category", "Size", "Price", "Cost", "Promo_Tag"],
      ["LW-1", "Tee", "Shirts", "M", "390", "1.234", "X".repeat(31)],
    ]);
    assert.ok(result.issues.some((i) => /Cost/.test(i.message)));
    assert.ok(result.issues.some((i) => /Promo_Tag/.test(i.message)));
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
