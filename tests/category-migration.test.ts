// Category migration planner: mapping coverage, the live snapshot, and the abort rules that protect products and promotions.
// Run with: npx tsx tests/category-migration.test.ts
import assert from "node:assert/strict";
import { MATRIX_CATEGORIES, OFFICIAL_CATEGORY_CODES } from "../lib/catalog-matrix";
import { LEGACY_CATEGORY_MAP, planCategoryMigration, type LiveCategory } from "../lib/category-migration";
import { isValidCategoryCode } from "../lib/master-codes";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

/** The categories as they stand in the database, read before the migration. */
const LIVE: LiveCategory[] = [
  { id: "c01", code: "01", name: "Long-Sleeved T-Shirt", slug: "long-sleeved-t-shirt", products: 0, promotions: 0 },
  { id: "c03", code: "03", name: "Polo Shirt", slug: "polo-shirt", products: 0, promotions: 0 },
  { id: "c04", code: "04", name: "Blouse", slug: "blouse", products: 0, promotions: 0 },
  { id: "c05", code: "05", name: "Pants", slug: "pants", products: 0, promotions: 0 },
  { id: "c06", code: "06", name: "Shorts", slug: "shorts", products: 0, promotions: 0 },
  { id: "c08", code: "08", name: "Dress", slug: "dress", products: 0, promotions: 0 },
  { id: "c09", code: "09", name: "Outerwear", slug: "outerwear", products: 0, promotions: 0 },
  { id: "c10", code: "10", name: "Accessories", slug: "accessories", products: 0, promotions: 0 },
  { id: "cd", code: "CAT-DRESS", name: "Dresses", slug: "dresses", products: 0, promotions: 0 },
  { id: "cs", code: "CAT-SHIRT", name: "Shirts", slug: "shirts", products: 0, promotions: 0 },
  { id: "sk", code: "SK", name: "Skirt", slug: "skirt", products: 0, promotions: 0 },
  { id: "sp", code: "SP", name: "Supplies", slug: "supplies", products: 1, promotions: 0 },
  { id: "sr", code: "SR", name: "Shirt", slug: "shirt", products: 0, promotions: 0 },
  { id: "ts", code: "TS", name: "Short-Sleeved T-Shirt", slug: "short-sleeved-t-shirt", products: 0, promotions: 0 },
];

(async () => {
  await test("mapping: every target is an official dictionary code, and the official codes are all valid", () => {
    for (const [from, to] of Object.entries(LEGACY_CATEGORY_MAP)) {
      assert.ok(OFFICIAL_CATEGORY_CODES.has(to), `${from} -> ${to} is in the dictionary`);
    }
    assert.equal(MATRIX_CATEGORIES.length, 39);
    for (const entry of MATRIX_CATEGORIES) assert.ok(isValidCategoryCode(entry.code), `${entry.code} passes the strict rule`);
    assert.equal(isValidCategoryCode("01"), false, "a legacy number is refused");
    assert.equal(isValidCategoryCode("CAT-SHIRT"), false, "a legacy CAT- code is refused");
    assert.equal(isValidCategoryCode("ts"), false, "the rule expects the stored upper-case code");
  });

  await test("live snapshot: creates the 36 missing codes, renames TS to its official name, removes the 11 legacy rows", () => {
    const plan = planCategoryMigration(LIVE);
    assert.deepEqual(plan.abort, []);
    assert.equal(plan.create.length, 36);
    assert.deepEqual(plan.rename.map((r) => [r.from, r.to]), [["Short-Sleeved T-Shirt", "Short T-Shirts"]]);
    assert.equal(plan.remove.length, 11);
    assert.ok(plan.moves.some((m) => m.from === "SP" && m.to === "BG" && m.products === 1));
  });

  await test("already migrated: a mapped source that is not in the database is reported, not created or deleted", () => {
    const plan = planCategoryMigration(LIVE);
    const gone = plan.alreadyMigrated.map((a) => a.from).sort();
    assert.deepEqual(gone, ["00", "02", "07", "CAT-ACC", "CAT-OUTER", "CAT-PANT"]);
    assert.ok(!plan.remove.some((r) => gone.includes(r.code)));
  });

  await test("abort: a product on a legacy category outside the mapping stops the whole migration", () => {
    const live: LiveCategory[] = [...LIVE, { id: "x", code: "CAT-HAT", name: "Hats", slug: "hats", products: 3, promotions: 0 }];
    const plan = planCategoryMigration(live);
    assert.ok(plan.abort.some((m) => /CAT-HAT.*3 product/.test(m)));
  });

  await test("abort: a promotion on a legacy category outside the mapping also stops it", () => {
    const live: LiveCategory[] = [...LIVE, { id: "y", code: "CAT-BAG", name: "Bags", slug: "bags", products: 0, promotions: 1 }];
    const plan = planCategoryMigration(live);
    assert.ok(plan.abort.some((m) => /CAT-BAG.*1 promotion/.test(m)));
  });

  await test("unused legacy row outside the mapping is removed", () => {
    const live: LiveCategory[] = [...LIVE, { id: "z", code: "CAT-OLD", name: "Old", slug: "old-stuff", products: 0, promotions: 0 }];
    const plan = planCategoryMigration(live);
    assert.deepEqual(plan.abort, []);
    assert.ok(plan.remove.some((r) => r.code === "CAT-OLD"));
  });

  await test("abort: a missing dictionary code whose slug belongs to another row would collide (TL, slug long-t-shirts)", () => {
    const live: LiveCategory[] = [...LIVE, { id: "q", code: "CAT-LONG", name: "Long again", slug: "long-t-shirts", products: 0, promotions: 0 }];
    const plan = planCategoryMigration(live);
    assert.ok(plan.abort.some((m) => /slug long-t-shirts/.test(m)));
  });

  await test("a dictionary code is never removed, even when unused", () => {
    const plan = planCategoryMigration(LIVE);
    const official = new Set(OFFICIAL_CATEGORY_CODES);
    assert.ok(plan.remove.every((r) => !official.has(r.code)));
  });

  console.log(`\n${passed} category-migration groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
