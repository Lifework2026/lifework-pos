// Template A visual preview: column mapping and the rows the review shows. Pure, no database.
// Run with: npx tsx tests/product-preview.test.ts
import assert from "node:assert/strict";
import type { ImportRow } from "../lib/catalog/import";
import { TEMPLATE_HEADER } from "../lib/catalog/import";
import { buildProductPreview, describeColumns, PREVIEW_ROW_LIMIT } from "../lib/catalog/import-preview";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

function row(overrides: Partial<ImportRow> & { line: number; sku: string }): ImportRow {
  return {
    name: "Example Tee",
    nameTh: "เสื้อยืด",
    categoryCode: "CAT-SHIRT",
    colorCode: "COL-BLK",
    size: "M",
    priceSatang: 39000,
    costSatang: 18000,
    stock: 10,
    barcode: "LW265TS99035M",
    promoTag: null,
    brand: null,
    description: null,
    ...overrides,
  };
}

(async () => {
  await test("column mapping: every template column found, whatever the case or spacing", () => {
    const table = [["barcode", "SKU", "Name TH", "Name_EN", "category code", "Color_Code", "Size", "Price", "Cost", "Initial Stock", "Promo Tag"]];
    const result = describeColumns(table, TEMPLATE_HEADER);
    assert.deepEqual(result.missingColumns, []);
    assert.equal(result.headers.length, 11);
  });

  await test("column mapping: a template column the file lacks is named, and blank header cells are ignored", () => {
    const table = [["Barcode", "SKU", "Name_TH", "Name_EN", "Category_Code", "Color_Code", "Size", "Price", "", "Initial_Stock"]];
    const result = describeColumns(table, TEMPLATE_HEADER);
    assert.deepEqual(result.missingColumns, ["Cost", "Promo_Tag"]);
    assert.equal(result.headers.includes(""), false);
  });

  await test("preview rows: status is skipped for rows the plan skips, otherwise new", () => {
    const rows = [row({ line: 2, sku: "A" }), row({ line: 3, sku: "B" })];
    const preview = buildProductPreview({
      rows,
      plan: { skipped: [{ line: 3, sku: "B" }] },
      headers: ["Barcode"],
      missingColumns: [],
      categories: [{ code: "CAT-SHIRT", name: "Shirts", nameTh: "เสื้อ" }],
      colors: [{ code: "COL-BLK", name: "Black", nameTh: "ดำ" }],
    });
    assert.deepEqual(preview.rows.map((r) => [r.line, r.status]), [
      [2, "new"],
      [3, "skipped"],
    ]);
    assert.equal(preview.rowCount, 2);
  });

  await test("preview rows: master names are attached, and a code with no master record shows as null", () => {
    const preview = buildProductPreview({
      rows: [row({ line: 2, sku: "A", categoryCode: "CAT-SHIRT", colorCode: "COL-NONE" })],
      plan: { skipped: [] },
      headers: [],
      missingColumns: [],
      categories: [{ code: "CAT-SHIRT", name: "Shirts", nameTh: "เสื้อ" }],
      colors: [],
    });
    const first = preview.rows[0];
    assert.equal(first.categoryName, "Shirts");
    assert.equal(first.categoryNameTh, "เสื้อ");
    assert.equal(first.colorName, null);
    assert.equal(first.colorNameTh, null);
  });

  await test("preview rows: the display is capped, but the row count covers the whole file", () => {
    const rows = Array.from({ length: PREVIEW_ROW_LIMIT + 5 }, (_, index) => row({ line: index + 2, sku: `S${index}` }));
    const preview = buildProductPreview({
      rows,
      plan: { skipped: [] },
      headers: [],
      missingColumns: [],
      categories: [],
      colors: [],
    });
    assert.equal(preview.rows.length, PREVIEW_ROW_LIMIT);
    assert.equal(preview.rowCount, PREVIEW_ROW_LIMIT + 5);
  });

  console.log(`\n${passed} product-preview groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
