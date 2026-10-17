// Leading zeros: text-formatted templates, numeric-cell detection, and parsers that keep codes such as 01 and BK.
// Run with: npx tsx tests/text-codes.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildTemplateWorkbook, TEMPLATES, textColumnIndexes, type MasterData, type TemplateType } from "../lib/excel-templates";
import { parseImportTable, TEMPLATE_HEADER } from "../lib/catalog/import";
import { parseMasterTable } from "../lib/catalog/master-import";
import { parseXlsxDetailed } from "../lib/tabular";
import { cellText, numericTextIssues, TEXT_COLUMNS } from "../lib/text-columns";

const require = createRequire(__filename);
const ExcelJS = require("exceljs");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const MASTER: MasterData = {
  categories: [{ code: "TS", name: "Short T-Shirts", nameTh: null }],
  colors: [{ code: "BK", name: "Black", nameTh: "ดำ" }],
};

/** Writes a workbook from rows with real numbers where given, then reads it back the way the importers do. */
async function parseWorkbook(rows: (string | number)[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  for (const row of rows) sheet.addRow(row);
  const out: Buffer = await workbook.xlsx.writeBuffer();
  const arrayBuffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  return parseXlsxDetailed(arrayBuffer as ArrayBuffer);
}

(async () => {
  await test("cell text: numbers keep their digits, text is trimmed, blanks are empty", () => {
    assert.equal(cellText(1), "1");
    assert.equal(cellText("  01 "), "01");
    assert.equal(cellText(null), "");
    assert.equal(cellText(undefined), "");
    assert.equal(cellText(Number.NaN), "");
  });

  await test("text columns are the five that carry leading zeros", () => {
    assert.deepEqual([...TEXT_COLUMNS], ["Barcode", "SKU", "Category_Code", "Color_Code", "Phone_Number"]);
  });

  await test("numeric cells in code, barcode, SKU or phone columns are refused with the line and the fix", () => {
    const table = [
      ["Barcode", "Category_Code", "Size"],
      ["LW0001", "01", "M"],
      ["LW0002", "2", "L"],
      ["0812345678", "BK", "XL"],
    ];
    const issues = numericTextIssues(table, [
      { row: 2, col: 1 },
      { row: 0, col: 0 },
      { row: 3, col: 2 },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].line, 3);
    assert.match(issues[0].message, /^Category_Code "2" was stored as a number/);
    assert.match(issues[0].message, /Format the column as Text/);
  });

  await test("numeric cells are not a problem when no text column holds them, or the file has none", () => {
    assert.deepEqual(numericTextIssues([["Name_EN", "Price"], ["Tee", "390"]], [{ row: 1, col: 1 }]), []);
    assert.deepEqual(numericTextIssues([["Category_Code"], ["01"]], []), []);
  });

  await test("reading an .xlsx reports the cells stored as numbers, by table row and column", async () => {
    const parsed = await parseWorkbook([
      ["Barcode", "Category_Code", "Color_Code"],
      ["LW0001", 1, "BK"],
      ["LW0002", "02", 0],
    ]);
    assert.deepEqual(parsed.table, [
      ["Barcode", "Category_Code", "Color_Code"],
      ["LW0001", "1", "BK"],
      ["LW0002", "02", "0"],
    ]);
    assert.deepEqual(parsed.numeric, [
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
    const issues = numericTextIssues(parsed.table, parsed.numeric);
    assert.deepEqual(issues.map((i) => i.line), [2, 3]);
  });

  await test("template D: codes such as TS are kept, lower case is upper-cased, and a number such as 01 is refused", () => {
    const ok = parseMasterTable(
      [
        ["Category_Code", "Category_Name"],
        ["TS", "Short T-Shirts"],
        ["BG", "BAG"],
      ],
      "category",
    );
    assert.deepEqual(ok.rows.map((r) => r.code), ["TS", "BG"]);
    assert.equal(ok.issues.length, 0);

    const bad = parseMasterTable([["Category_Code", "Category_Name"], ["1", "Single digit"]], "category");
    assert.ok(bad.issues.some((i) => i.line === 2 && /Category_Code '1'/.test(i.message)));
  });

  await test("template E: BK and 02 are accepted for colours", () => {
    const result = parseMasterTable([["Color_Code", "Color_Name"], ["bk", "Black"], ["02", "White"]], "color");
    assert.deepEqual(result.rows.map((r) => r.code), ["BK", "02"]);
    assert.equal(result.issues.length, 0);
  });

  await test("example rows are refused by name, so the sample codes 01 and BK cannot create anything", () => {
    const d = parseMasterTable([["Category_Code", "Category_Name"], ["TS", "EXAMPLE Short T-Shirts"]], "category");
    assert.ok(d.issues.some((i) => i.line === 2 && /example row/.test(i.message)));
    const e = parseMasterTable([["Color_Code", "Color_Name"], ["BK", "EXAMPLE Black"]], "color");
    assert.ok(e.issues.some((i) => i.line === 2 && /example row/.test(i.message)));
    // A real name that starts with Example is not a sample.
    const real = parseMasterTable([["Category_Code", "Category_Name"], ["BG", "Example Wear"]], "category");
    assert.equal(real.issues.length, 0);
  });

  await test("template A: Category_Code 01 and colour bk come through as text and upper case", () => {
    const table = [
      TEMPLATE_HEADER,
      ["LW265TS0100M", "LW-TEE-01-M", "เสื้อยืด", "Tee", " ts ", "bk", "M", "390", "180", "10", ""],
    ];
    const parsed = parseImportTable(table);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.rows[0].categoryCode, "TS");
    assert.equal(parsed.rows[0].colorCode, "BK");
  });

  await test("template files: every text column is formatted as Text in the cells and the column, to the last row", async () => {
    const types: TemplateType[] = ["A", "B", "C", "D", "E", "F"];
    for (const type of types) {
      const buffer = await buildTemplateWorkbook(type, MASTER);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const data = workbook.getWorksheet("Data");
      const header = (data.getRow(1).values as unknown[]).slice(1) as string[];
      const indexes = textColumnIndexes(TEMPLATES[type].header);
      assert.equal(header.length, TEMPLATES[type].header.length, `${type} header width`);
      assert.ok(indexes.length >= 1, `${type} has at least one text column`);
      for (const index of indexes) {
        assert.ok(TEXT_COLUMNS.includes(header[index] as never), `${type} ${header[index]} is a text column`);
        assert.equal(data.getCell(2, index + 1).numFmt, "@", `${type} ${header[index]} example row is Text`);
        assert.equal(data.getCell(2001, index + 1).numFmt, "@", `${type} ${header[index]} last row is Text`);
      }
      if (type === "A") {
        const codes = workbook.getWorksheet("Master_Data_Codes");
        assert.equal(codes.getCell(2, 2).numFmt, "@", "Master_Data_Codes code column is Text");
        assert.equal(codes.getCell(2, 2).value, "TS");
      }
    }
  });

  await test("template A example uses the live category and colour codes, not the old CAT- and COL- samples", () => {
    const example = TEMPLATES.A.example(MASTER);
    assert.equal(example[4], "TS");
    assert.equal(example[5], "BK");
    assert.equal(TEMPLATES.D.example(MASTER)[0], "TS");
    assert.equal(TEMPLATES.E.example(MASTER)[0], "00");
  });

  console.log(`\n${passed} leading-zero groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
