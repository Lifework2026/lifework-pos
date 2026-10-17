// Preparing a packing-list file: filling prices by style, setting aside rows with no price, and splitting a long file.
// Run with: npx tsx tests/packing-import.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fillPricesByStyle, formatBaht, splitByPrice, splitTableByStyle } from "../lib/catalog/packing-import";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const HEADER = ["Barcode", "SKU", "Name_TH", "Name_EN", "Category_Code", "Color_Code", "Size", "Price", "Cost", "Initial_Stock", "Promo_Tag"];
const row = (style: string, color: string, size: string, price = ""): string[] => [`${style}${color}${size}`, `${style}${color}${size}`, "", style, "TS", color, size, price, "", "", ""];

(async () => {
  await test("price: a style's price goes on every blank-price row of that style", () => {
    const table = [HEADER, row("LW262TS116", "11", "S"), row("LW262TS116", "23", "M"), row("LW265TS990", "35", "S")];
    const fill = fillPricesByStyle(table, new Map([["LW262TS116", 1790]]));
    assert.deepEqual(fill.table.slice(1).map((r) => r[7]), ["1790", "1790", ""]);
    assert.equal(fill.filled, 2);
    assert.deepEqual(fill.styles, ["LW262TS116"]);
  });

  await test("price: a price already in the file is never changed", () => {
    const table = [HEADER, row("LW262TS116", "11", "S", "1500"), row("LW262TS116", "23", "S")];
    const fill = fillPricesByStyle(table, new Map([["LW262TS116", 1790]]));
    assert.deepEqual(fill.table.slice(1).map((r) => r[7]), ["1500", "1790"]);
    assert.equal(fill.keptExisting, 1);
  });

  await test("price: styles in the price list that the file does not have are reported", () => {
    const fill = fillPricesByStyle([HEADER, row("LW262TS116", "11", "S")], new Map([["LW262TS116", 1790], ["LW999XX999", 100]]));
    assert.deepEqual(fill.unused, ["LW999XX999"]);
  });

  await test("price: the input table is not changed", () => {
    const table = [HEADER, row("LW262TS116", "11", "S")];
    fillPricesByStyle(table, new Map([["LW262TS116", 1790]]));
    assert.equal(table[1][7], "");
  });

  await test("price: a file with no Price or Name_EN column is refused clearly", () => {
    assert.throws(() => fillPricesByStyle([["SKU"], ["x"]], new Map()), /Name_EN/);
  });

  await test("price: whole baht stay whole, others keep two decimals", () => {
    assert.equal(formatBaht(1790), "1790");
    assert.equal(formatBaht(1290.5), "1290.50");
  });

  await test("set aside: rows with a price are imported now, the rest wait, and nothing is lost", () => {
    const table = [HEADER, row("LW262TS116", "11", "S", "1790"), row("LW265TS990", "35", "S"), row("LW262TS116", "23", "S", "1790"), row("LW265TS992", "00", "M", "  ")];
    const split = splitByPrice(table);
    assert.equal(split.priced.length - 1, 2);
    assert.equal(split.unpriced.length - 1, 2);
    assert.deepEqual(split.unpricedStyles, ["LW265TS990", "LW265TS992"]);
    assert.deepEqual(split.priced[0], HEADER);
    assert.deepEqual(split.unpriced[0], HEADER);
  });

  await test("split: a long file becomes pieces within the limit, each with the header, and no row is lost or repeated", () => {
    const rows: string[][] = [];
    for (let s = 0; s < 30; s++) for (let v = 0; v < 7; v++) rows.push(row(`LW262TS${String(100 + s)}`, String(v), "S", "100"));
    const pieces = splitTableByStyle([HEADER, ...rows], 50);
    assert.ok(pieces.length > 1);
    for (const piece of pieces) {
      assert.deepEqual(piece[0], HEADER);
      assert.ok(piece.length - 1 <= 50);
    }
    assert.deepEqual(pieces.flatMap((p) => p.slice(1)), rows);
  });

  await test("split: a style is kept in one piece when it fits", () => {
    const rows: string[][] = [];
    for (let s = 0; s < 10; s++) for (let v = 0; v < 7; v++) rows.push(row(`LW262TS${100 + s}`, String(v), "S", "100"));
    const pieces = splitTableByStyle([HEADER, ...rows], 25);
    const stylesPerPiece = pieces.map((p) => new Set(p.slice(1).map((r) => r[3])));
    for (const style of Array.from(new Set(rows.map((r) => r[3])))) {
      assert.equal(stylesPerPiece.filter((set) => set.has(style)).length, 1, `${style} is in exactly one piece`);
    }
  });

  await test("split: one style bigger than the limit is cut as a last resort, still without losing rows", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row("LW262TS116", String(i), "S", "100"));
    const pieces = splitTableByStyle([HEADER, ...rows], 5);
    assert.deepEqual(pieces.map((p) => p.length - 1), [5, 5, 2]);
    assert.deepEqual(pieces.flatMap((p) => p.slice(1)), rows);
  });

  await test("split: a file within the limit is one piece", () => {
    const rows = [row("LW262TS116", "11", "S", "1")];
    assert.deepEqual(splitTableByStyle([HEADER, ...rows], 2000), [[HEADER, ...rows]]);
  });

  await test("script: preview by default, one transaction, same checks as the admin page, and no stock written", () => {
    const script = readFileSync(path.join(__dirname, "..", "scripts", "import-packing-list.ts"), "utf8");
    assert.ok(script.includes('args.includes("--apply")') && script.includes("if (!apply)"));
    assert.ok(script.indexOf("if (!apply)") < script.indexOf("commitImport(tx"), "the preview returns before any write");
    assert.ok(script.includes("Serializable") && script.includes("planImport(tx") && script.includes("expected"));
    assert.ok(script.includes("applyStock: false") && script.includes('onExisting: "skip"'));
    assert.ok(script.includes("parseImportTable"), "every row passes the importer's own validation");
  });

  console.log(`\n${passed} packing-import groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
