// Templates D (categories), E (colours) and F (members): parsing, create-or-update planning and the template files.
// Run with: npx tsx tests/master-data.test.ts
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { buildTemplateWorkbook } from "../lib/excel-templates";
import { parseMasterTable, planCategories, planColors } from "../lib/catalog/master-import";
import { MEMBER_TEMPLATE_HEADER, parseMemberTable, planMembers } from "../lib/members/import";
import { IMPORT_TEMPLATES, TEMPLATE_KEYS, importEndpoint, templateHref } from "../lib/template-catalog";
import { createRequire } from "node:module";

const require = createRequire(__filename);
const ExcelJS = require("exceljs");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

/** Only the model calls the planners make. Each returns a fixed snapshot of the database. */
function fakeTx(snapshot: {
  categories?: { id: string; code: string; name: string; slug: string }[];
  colors?: { id: string; code: string; name: string; sortOrder: number }[];
  members?: { id: string; phone: string; name: string; points: number }[];
}): Prisma.TransactionClient {
  return {
    category: { findMany: async () => snapshot.categories ?? [] },
    color: {
      findMany: async () => snapshot.colors ?? [],
      aggregate: async () => ({ _max: { sortOrder: Math.max(0, ...(snapshot.colors ?? []).map((c) => c.sortOrder)) } }),
    },
    member: { findMany: async () => snapshot.members ?? [] },
  } as unknown as Prisma.TransactionClient;
}

(async () => {
  await test("template D: categories parse, codes are upper-cased, duplicates and bad codes are refused", () => {
    const ok = parseMasterTable(
      [
        ["Category_Code", "Category_Name"],
        ["cat-bags", "Bags"],
        ["CAT-HATS", "Hats"],
      ],
      "category",
    );
    assert.deepEqual(
      ok.rows.map((r) => r.code),
      ["CAT-BAGS", "CAT-HATS"],
    );
    assert.equal(ok.issues.length, 0);

    const bad = parseMasterTable(
      [
        ["Category_Code", "Category_Name"],
        ["A", "Too short"],
        ["CAT-BAGS", "Bags"],
        ["CAT-BAGS", "Bags again"],
        ["EXAMPLE-CAT", "EXAMPLE CATEGORY"],
      ],
      "category",
    );
    assert.ok(bad.issues.some((i) => i.line === 2 && /Category_Code 'A'/.test(i.message)));
    assert.ok(bad.issues.some((i) => i.line === 4 && /already on line 3/.test(i.message)));
    assert.ok(bad.issues.some((i) => i.line === 5 && /example row/.test(i.message)));
  });

  await test("template E: a missing Color_Name column is reported on line 1", () => {
    const result = parseMasterTable([["Color_Code"], ["COL-RED"]], "color");
    assert.ok(result.issues.some((i) => i.line === 1 && /Color_Name/.test(i.message)));
    assert.equal(result.rows.length, 0);
  });

  await test("template E: unknown columns are reported, not silently dropped", () => {
    const result = parseMasterTable([["Color_Code", "Color_Name", "Notes"], ["COL-RED", "Red", "x"]], "color");
    assert.deepEqual(result.unknownColumns, ["Notes"]);
    assert.equal(result.issues.length, 0);
  });

  await test("template D: planning creates new codes, renames known ones and refuses a name owned by another code", async () => {
    const tx = fakeTx({
      categories: [
        { id: "c1", code: "CAT-SHIRT", name: "Shirts", slug: "shirts" },
        { id: "c2", code: "CAT-PANT", name: "Pants", slug: "pants" },
      ],
    });
    const plan = await planCategories(tx, [
      { line: 2, code: "CAT-SHIRT", name: "Tops" },
      { line: 3, code: "CAT-BAGS", name: "Bags" },
      { line: 4, code: "CAT-PANT", name: "Pants" },
      { line: 5, code: "CAT-SKIRT", name: "shirts" },
    ]);
    assert.deepEqual(plan.updates.map((u) => [u.code, u.from, u.to]), [["CAT-SHIRT", "Shirts", "Tops"]]);
    assert.deepEqual(plan.creates.map((c) => [c.code, c.slug]), [["CAT-BAGS", "bags"]]);
    assert.equal(plan.unchanged, 1);
    assert.ok(plan.issues.some((i) => i.line === 5 && /already exists under code CAT-SHIRT/.test(i.message)));
  });

  await test("template E: planning keeps the sort order running on and refuses a colour name already in use", async () => {
    const tx = fakeTx({ colors: [{ id: "k1", code: "COL-BLK", name: "Black", sortOrder: 1 }] });
    const plan = await planColors(tx, [
      { line: 2, code: "COL-BLK", name: "Black" },
      { line: 3, code: "COL-RED", name: "Red" },
      { line: 4, code: "COL-BLU", name: "black" },
    ]);
    assert.equal(plan.unchanged, 1);
    assert.deepEqual(plan.creates.map((c) => [c.code, c.sortOrder]), [["COL-RED", 2]]);
    assert.ok(plan.issues.some((i) => i.line === 4 && /already exists under code COL-BLK/.test(i.message)));
  });

  await test("template F: header and phone numbers are checked; dashes are ignored", () => {
    assert.deepEqual(MEMBER_TEMPLATE_HEADER, ["Phone_Number", "First_Name", "Last_Name", "Points"]);
    const result = parseMemberTable([
      ["Phone_Number", "First_Name", "Last_Name", "Points"],
      ["081-234-5678", "Somchai", "", "120"],
      ["12345", "Short", "", ""],
      ["0899999999", "Blank", "Points", ""],
      ["0899999999", "Again", "", ""],
    ]);
    assert.deepEqual(result.rows.map((r) => [r.phone, r.name, r.points]), [
      ["0812345678", "Somchai", 120],
      // The repeated phone is kept but reported as an issue, and any issue blocks both preview and commit.
      ["0899999999", "Blank Points", null],
      ["0899999999", "Again", null],
    ]);
    assert.ok(result.issues.some((i) => i.line === 3 && /must be 9 or 10 digits/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 5 && /already on line 4/.test(i.message)));
  });

  await test("template F: points must be whole numbers and the example row is refused", () => {
    const result = parseMemberTable([
      ["Phone_Number", "First_Name", "Points"],
      ["0812345678", "Ann", "-5"],
      ["0823456789", "Ben", "2.5"],
      ["0834567890", "EXAMPLE", "0"],
    ]);
    assert.ok(result.issues.some((i) => i.line === 2 && /whole number of 0 or more/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 3 && /whole number of 0 or more/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 4 && /example row/.test(i.message)));
  });

  await test("template F: planning updates by phone, keeps blank points, and creates new phones at 0", async () => {
    const tx = fakeTx({ members: [
        { id: "m1", phone: "0812345678", name: "Old Name", points: 10 },
        { id: "m2", phone: "0855555555", name: "Before", points: 5 },
      ],
    });
    const plan = await planMembers(tx, [
      { line: 2, phone: "0855555555", name: "After", points: null },
      { line: 3, phone: "0812345678", name: "Old Name", points: 25 },
      { line: 4, phone: "0899999999", name: "Fresh", points: null },
      { line: 5, phone: "0877777777", name: "Set", points: 40 },
    ]);
    assert.deepEqual(plan.updates.map((u) => [u.phone, u.name, u.pointsFrom, u.pointsTo]), [
      ["0855555555", "After", 5, null],
      ["0812345678", "Old Name", 10, 25],
    ]);
    assert.deepEqual(plan.creates.map((c) => [c.phone, c.points]), [
      ["0899999999", 0],
      ["0877777777", 40],
    ]);
    assert.equal(plan.unchanged, 0);
  });

  await test("template D, E, F: the template files have the exact headers and an example row", async () => {
    for (const type of ["D", "E", "F"] as const) {
      const buffer = await buildTemplateWorkbook(type);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const data = wb.getWorksheet("Data");
      const header = (data.getRow(1).values as unknown[]).slice(1);
      const expected = type === "D" ? ["Category_Code", "Category_Name"] : type === "E" ? ["Color_Code", "Color_Name"] : MEMBER_TEMPLATE_HEADER;
      assert.deepEqual(header, expected);
      assert.ok(data.rowCount >= 2, `template ${type} has an example row`);
      assert.ok(wb.getWorksheet("Instructions"), `template ${type} has instructions`);
    }
  });

  await test("action bar: every list page's template has a dialog spec, a download link and an import endpoint", () => {
    assert.deepEqual([...TEMPLATE_KEYS], ["A", "B", "C", "D", "E", "F"]);
    for (const type of TEMPLATE_KEYS) {
      assert.ok(IMPORT_TEMPLATES[type].titleKey.startsWith("xls."), `${type} title key`);
      assert.ok(IMPORT_TEMPLATES[type].columns.length > 0, `${type} columns`);
      assert.ok(templateHref(type).startsWith("/api/admin/"), `${type} download link`);
    }
    assert.equal(importEndpoint("A"), "/api/admin/products/import");
    assert.equal(importEndpoint("F"), "/api/admin/excel/import");
    assert.equal(templateHref("A"), "/api/admin/products/import/template?format=xlsx");
    assert.equal(templateHref("D"), "/api/admin/excel/templates?type=D");
  });

  console.log(`\n${passed} master-data groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
