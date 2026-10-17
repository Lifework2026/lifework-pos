// Photos by colour: which photo a variant shows, how many colours a product has covered, and the structure that keeps
// colour photos on the product's own colours. Run with: npx tsx tests/color-photos.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { colorGroups, photoCoverage, variantImageUrl } from "../lib/catalog/variant-image";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

const white = { colorId: "c-white", imageUrl: "https://files.example/white.jpg" };
const black = { colorId: "c-black", imageUrl: "https://files.example/black.jpg" };

(async () => {
  await test("variant photo: its colour's photo wins over the product photo", () => {
    const product = { imageUrl: "https://files.example/style.jpg", colorImages: [white, black] };
    assert.equal(variantImageUrl(product, "c-black"), black.imageUrl);
    assert.equal(variantImageUrl(product, "c-white"), white.imageUrl);
  });

  await test("variant photo: a colour with no photo of its own shows the product photo", () => {
    const product = { imageUrl: "https://files.example/style.jpg", colorImages: [white] };
    assert.equal(variantImageUrl(product, "c-red"), "https://files.example/style.jpg");
  });

  await test("variant photo: nothing at all gives no photo", () => {
    assert.equal(variantImageUrl({ imageUrl: null, colorImages: [] }, "c-red"), null);
  });

  await test("variant photo: every size of a colour gets the same photo", () => {
    const product = { imageUrl: null, colorImages: [white] };
    const sizes = ["S", "M", "L", "XL"].map(() => variantImageUrl(product, "c-white"));
    assert.deepEqual(sizes, [white.imageUrl, white.imageUrl, white.imageUrl, white.imageUrl]);
  });

  await test("coverage: three colours in several sizes need three photos, not one per size", () => {
    const variants = ["S", "M", "L"].flatMap(() => [{ colorId: "c-white" }, { colorId: "c-black" }, { colorId: "c-red" }]);
    assert.deepEqual(photoCoverage({ imageUrl: null, variants, colorImages: [white, black] }), { colors: 3, withPhoto: 2, missing: 1 });
  });

  await test("coverage: a product photo covers every colour that has none of its own", () => {
    const variants = [{ colorId: "c-white" }, { colorId: "c-black" }];
    assert.deepEqual(photoCoverage({ imageUrl: "https://files.example/style.jpg", variants, colorImages: [] }), { colors: 2, withPhoto: 2, missing: 0 });
  });

  await test("coverage: no photo anywhere leaves every colour missing", () => {
    const variants = [{ colorId: "c-white" }, { colorId: "c-white" }, { colorId: "c-black" }];
    assert.deepEqual(photoCoverage({ imageUrl: null, variants, colorImages: [] }), { colors: 2, withPhoto: 0, missing: 2 });
  });

  await test("colour groups: one group per colour, with its sizes once each, in the order they come", () => {
    const groups = colorGroups([
      { colorId: "c-white", color: "WHITE", size: "S" },
      { colorId: "c-black", color: "BLACK", size: "S" },
      { colorId: "c-white", color: "WHITE", size: "M" },
      { colorId: "c-white", color: "WHITE", size: "S" },
    ]);
    assert.deepEqual(groups, [
      { colorId: "c-white", color: "WHITE", sizes: ["S", "M"] },
      { colorId: "c-black", color: "BLACK", sizes: ["S"] },
    ]);
  });

  await test("structure: the colour photo route is manager-only, audited, and only for colours the product is sold in", () => {
    const route = read("app/api/admin/products/[id]/colors/[colorId]/image/route.ts");
    assert.equal((route.match(/await requireManager\(\)/g) ?? []).length, 2, "POST and DELETE both require a manager");
    assert.ok(route.includes("productVariant.count") && route.includes("sold === 0"), "the colour must be one the product uses");
    assert.ok(route.includes("replaceProductImage") && route.includes("removeProductImage"));
    assert.ok(route.includes("PRODUCT_COLOR_IMAGE_SET") && route.includes("PRODUCT_COLOR_IMAGE_REMOVED"));
  });

  await test("structure: the till shows the colour photo in the list, the barcode lookup and a resumed held bill", () => {
    for (const file of ["app/api/products/route.ts", "app/api/products/search/route.ts", "app/api/held-bills/[id]/resume/route.ts"]) {
      const code = read(file);
      assert.ok(code.includes("variantImageUrl("), `${file} picks the photo by colour`);
      assert.ok(code.includes("colorImages"), `${file} reads the colour photos`);
      assert.ok(code.includes("colorId: true"), `${file} reads the variant's colour`);
    }
  });

  await test("structure: deleting a product also deletes its colour photo files", () => {
    const route = read("app/api/admin/products/[id]/route.ts");
    assert.ok(route.includes("colorImagePaths") && route.includes("colorImages: { select: { imagePath: true } }"));
  });

  await test("structure: the product form has a photo slot for each colour, and the list shows photo coverage", () => {
    assert.ok(read("components/admin/product-form.tsx").includes("<ProductColorPhotos"));
    assert.ok(read("components/admin/product-color-photos.tsx").includes("/colors/${group.colorId}/image"));
    const page = read("app/admin/products/page.tsx");
    assert.ok(page.includes("photoCoverage(") && page.includes("products.photoCoverage"));
  });

  await test("structure: the migration adds one table, keeps one photo per product and colour, and deletes nothing", () => {
    const sql = read("prisma/migrations/20261022000000_product_color_images/migration.sql");
    assert.ok(sql.includes('CREATE TABLE "ProductColorImage"'));
    assert.ok(sql.includes('UNIQUE INDEX "ProductColorImage_productId_colorId_key"'));
    assert.ok(sql.includes('ProductColorImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE'));
    assert.ok(sql.includes('REFERENCES "Color"("id") ON DELETE RESTRICT'));
    assert.ok(!/DROP\s|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+"(?!ProductColorImage)/i.test(sql), "no existing table is changed");
  });

  console.log(`\n${passed} color-photo groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
