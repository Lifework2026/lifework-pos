// Master Data hub: the starter SKU matrix, and the rule that clears only unused legacy demo codes.
// Run with: npx tsx tests/master-hub.test.ts
import assert from "node:assert/strict";
import { MATRIX_CATEGORIES, MATRIX_COLORS } from "../lib/catalog-matrix";
import { CODE_PATTERN } from "../lib/master-codes";
import { CLEAR_DEMO_PHRASE, isLegacyDemoCode, planDemoClear } from "../lib/master-demo";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

(async () => {
  await test("matrix: every category and colour code is valid, unique, and not in the legacy CAT-/COL- scheme", () => {
    const categoryCodes = MATRIX_CATEGORIES.map((c) => c.code);
    const colorCodes = MATRIX_COLORS.map((c) => c.code);
    for (const code of [...categoryCodes, ...colorCodes]) {
      assert.ok(CODE_PATTERN.test(code), `${code} matches the code rule`);
      assert.equal(isLegacyDemoCode(code), false, `${code} is not a legacy code`);
    }
    assert.equal(new Set(categoryCodes).size, categoryCodes.length, "category codes are unique");
    assert.equal(new Set(colorCodes).size, colorCodes.length, "colour codes are unique");
  });

  await test("matrix: 00 is Short-Sleeved T-Shirt and WH is White, as the setup guide says", () => {
    const category = MATRIX_CATEGORIES.find((c) => c.code === "00");
    const colour = MATRIX_COLORS.find((c) => c.code === "WH");
    assert.equal(category?.name, "Short-Sleeved T-Shirt");
    assert.equal(colour?.name, "White");
    assert.equal(MATRIX_COLORS.find((c) => c.code === "BK")?.name, "Black");
  });

  await test("matrix: colour names are unique, because the database requires it", () => {
    const names = MATRIX_COLORS.map((c) => c.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });

  await test("legacy detection: only the CAT- and COL- scheme counts as demo", () => {
    assert.equal(isLegacyDemoCode("CAT-ACC"), true);
    assert.equal(isLegacyDemoCode("COL-STD"), true);
    assert.equal(isLegacyDemoCode("00"), false);
    assert.equal(isLegacyDemoCode("WH"), false);
    assert.equal(isLegacyDemoCode("CATALOG-1"), false);
  });

  await test("clear: removes only unused legacy codes, keeps legacy codes in use with their count", () => {
    const plan = planDemoClear([
      { id: "a", code: "CAT-ACC", uses: 0 },
      { id: "b", code: "CAT-SHIRT", uses: 3 },
      { id: "c", code: "00", uses: 0 },
      { id: "d", code: "COL-STD", uses: 0 },
      { id: "e", code: "WH", uses: 0 },
    ]);
    assert.deepEqual(plan.remove, [
      { id: "a", code: "CAT-ACC" },
      { id: "d", code: "COL-STD" },
    ]);
    assert.deepEqual(plan.keep, [{ code: "CAT-SHIRT", uses: 3 }]);
  });

  await test("clear: a matrix code is never planned for removal, even when nothing uses it", () => {
    const plan = planDemoClear(MATRIX_COLORS.map((c, index) => ({ id: `m${index}`, code: c.code, uses: 0 })));
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.keep, []);
  });

  await test("clear: the confirmation phrase is fixed", () => {
    assert.equal(CLEAR_DEMO_PHRASE, "CLEAR DEMO");
  });

  console.log(`\n${passed} master-hub groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
