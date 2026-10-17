// Master Data hub: the official category dictionary, the numbered colours, and the rule that clears only unused legacy codes.
// Run with: npx tsx tests/master-hub.test.ts
import assert from "node:assert/strict";
import { MATRIX_CATEGORIES, MATRIX_COLORS, OFFICIAL_CATEGORY_CODES } from "../lib/catalog-matrix";
import { CATEGORY_CODE_PATTERN, CODE_PATTERN } from "../lib/master-codes";
import { CLEAR_DEMO_PHRASE, isLegacyCategoryCode, isLegacyColorCode, planDemoClear } from "../lib/master-demo";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

(async () => {
  await test("dictionary: 39 categories, each a two-letter capital code, unique, and in the official list", () => {
    assert.equal(MATRIX_CATEGORIES.length, 39);
    const codes = MATRIX_CATEGORIES.map((c) => c.code);
    for (const code of codes) assert.ok(CATEGORY_CODE_PATTERN.test(code), `${code} is two capital letters`);
    assert.equal(new Set(codes).size, codes.length, "codes are unique");
    assert.ok(OFFICIAL_CATEGORY_CODES.has("TS") && OFFICIAL_CATEGORY_CODES.has("BG") && OFFICIAL_CATEGORY_CODES.has("ZT"));
  });

  await test("dictionary: TS is Short T-Shirts and BG is BAG, as the guidance says", () => {
    assert.equal(MATRIX_CATEGORIES.find((c) => c.code === "TS")?.name, "Short T-Shirts");
    assert.equal(MATRIX_CATEGORIES.find((c) => c.code === "BG")?.name, "BAG");
  });

  await test("dictionary: names and slugs are unique, so the database can store them", () => {
    const names = MATRIX_CATEGORIES.map((c) => c.name.toLowerCase());
    const slugs = MATRIX_CATEGORIES.map((c) => c.slug);
    assert.equal(new Set(names).size, names.length, "names are unique");
    assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
  });

  await test("colours: numbered 00-23, unique codes and unique names, and the colour rule still accepts them", () => {
    assert.equal(MATRIX_COLORS.length, 24);
    assert.equal(MATRIX_COLORS.find((c) => c.code === "00")?.name, "White");
    assert.equal(MATRIX_COLORS.find((c) => c.code === "23")?.name, "Sky Blue");
    const codes = MATRIX_COLORS.map((c) => c.code);
    const names = MATRIX_COLORS.map((c) => c.name.toLowerCase());
    for (const code of codes) assert.ok(CODE_PATTERN.test(code), `${code} matches the colour rule`);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(new Set(names).size, names.length);
  });

  await test("legacy categories: anything outside the dictionary, and never a dictionary code", () => {
    assert.equal(isLegacyCategoryCode("CAT-ACC"), true);
    assert.equal(isLegacyCategoryCode("00"), true);
    assert.equal(isLegacyCategoryCode("SP"), true);
    assert.equal(isLegacyCategoryCode("TS"), false);
    assert.equal(isLegacyCategoryCode("BG"), false);
  });

  await test("legacy colours: only the COL- scheme, so the numbered colours are never candidates", () => {
    assert.equal(isLegacyColorCode("COL-STD"), true);
    assert.equal(isLegacyColorCode("00"), false);
    assert.equal(isLegacyColorCode("ST"), false);
  });

  await test("clear: removes only unused legacy codes of the kind it is given, and keeps those in use with their count", () => {
    const plan = planDemoClear(
      [
        { id: "a", code: "CAT-ACC", uses: 0 },
        { id: "b", code: "CAT-SHIRT", uses: 3 },
        { id: "c", code: "TS", uses: 0 },
        { id: "d", code: "00", uses: 0 },
      ],
      isLegacyCategoryCode,
    );
    assert.deepEqual(plan.remove, [
      { id: "a", code: "CAT-ACC" },
      { id: "d", code: "00" },
    ]);
    assert.deepEqual(plan.keep, [{ code: "CAT-SHIRT", uses: 3 }]);
  });

  await test("clear: a numbered colour or a dictionary category is never planned for removal, even when unused", () => {
    const colours = planDemoClear(
      MATRIX_COLORS.map((c, index) => ({ id: `m${index}`, code: c.code, uses: 0 })),
      isLegacyColorCode,
    );
    const categories = planDemoClear(
      MATRIX_CATEGORIES.map((c, index) => ({ id: `d${index}`, code: c.code, uses: 0 })),
      isLegacyCategoryCode,
    );
    assert.deepEqual(colours.remove, []);
    assert.deepEqual(categories.remove, []);
  });

  await test("clear: the confirmation phrase is fixed", () => {
    assert.equal(CLEAR_DEMO_PHRASE, "CLEAR DEMO");
  });

  console.log(`\n${passed} master-hub groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
