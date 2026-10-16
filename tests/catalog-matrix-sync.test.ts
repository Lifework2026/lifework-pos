// Matrix sync planner: renames legacy rows by exact name, creates what is missing, never deletes, and reports clashes.
// Run with: npx tsx tests/catalog-matrix-sync.test.ts
import assert from "node:assert/strict";
import { planMatrixSync } from "../lib/catalog-matrix-sync";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const legacyCategories = [
  { id: "c-pants", code: "CAT-PANT", name: "Pants", slug: "pants" },
  { id: "c-sup", code: "CAT-SUP", name: "Supplies", slug: "supplies" },
  { id: "c-shirts", code: "CAT-SHIRT", name: "Shirts", slug: "shirts" },
];
const legacyColors = [
  { id: "k-white", code: "COL-WHT", name: "White" },
  { id: "k-std", code: "COL-STD", name: "Standard" },
  { id: "k-grey", code: "COL-GRY", name: "Grey" },
];

(async () => {
  await test("categories: an exact legacy name is renamed to its matrix code, keeping the same row", () => {
    const plan = planMatrixSync(legacyCategories, []);
    assert.deepEqual(
      plan.renameCategories.map((r) => [r.id, r.from, r.to]),
      [
        ["c-pants", "CAT-PANT", "05"],
        ["c-sup", "CAT-SUP", "SP"],
      ],
    );
  });

  await test("categories: names that differ are not renamed, and the matrix entry is created instead", () => {
    const plan = planMatrixSync(legacyCategories, []);
    // "Shirts" is not "Shirt", so the legacy row is left alone and 02 Shirt is created.
    assert.ok(plan.createCategories.some((c) => c.code === "02"));
    assert.ok(!plan.renameCategories.some((r) => r.id === "c-shirts"));
  });

  await test("categories: a matrix code that already exists is left unchanged", () => {
    const plan = planMatrixSync([{ id: "x", code: "00", name: "Short-Sleeved T-Shirt", slug: "short-sleeved-t-shirt" }], []);
    assert.ok(plan.unchanged.includes("category 00"));
    assert.ok(!plan.createCategories.some((c) => c.code === "00"));
  });

  await test("categories: a slug held by an unrelated row is reported as a conflict, not overwritten", () => {
    const plan = planMatrixSync([{ id: "h", code: "CAT-HAT", name: "Hats", slug: "shirt" }], []);
    assert.ok(plan.conflicts.some((m) => /category 02 .*slug shirt/.test(m)));
    assert.ok(!plan.createCategories.some((c) => c.code === "02"));
  });

  await test("colours: the legacy White becomes 00, and rows that are not in the list are left alone", () => {
    const plan = planMatrixSync([], legacyColors);
    assert.deepEqual(plan.renameColors.map((r) => [r.from, r.to]), [["COL-WHT", "00"]]);
    assert.ok(!plan.renameColors.some((r) => r.id === "k-std" || r.id === "k-grey"), "Standard and Grey are not in the list");
    assert.ok(plan.createColors.some((c) => c.code === "01" && c.name === "Off White"));
    assert.ok(!plan.createColors.some((c) => c.name === "White"), "White is not created twice");
  });

  await test("colours: a name held by an unrelated code is renamed to its list code, never duplicated", () => {
    const plan = planMatrixSync([], [{ id: "k", code: "XYZ", name: "sky blue" }]);
    assert.deepEqual(plan.renameColors.map((r) => [r.from, r.to]), [["XYZ", "23"]]);
    assert.ok(!plan.createColors.some((c) => c.code === "23"));
  });

  await test("colours: a code already in the list is unchanged", () => {
    const plan = planMatrixSync([], [{ id: "k", code: "00", name: "White" }]);
    assert.ok(plan.unchanged.includes("colour 00"));
    assert.equal(plan.renameColors.length, 0);
  });

  await test("the plan never removes a row, so every legacy id appears at most once as a rename", () => {
    const plan = planMatrixSync(legacyCategories, legacyColors);
    const ids = [...plan.renameCategories, ...plan.renameColors].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  console.log(`\n${passed} matrix-sync groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
