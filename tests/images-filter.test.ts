// Product photos (saved on the product the moment they upload), the Supabase bucket script, and the product filters.
// Run with: npx tsx tests/images-filter.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseProductFilter, productWhere } from "../lib/catalog/product-filter";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type DetectedImage } from "../lib/image-type";
import {
  ProductImageNotFound,
  removeProductImage,
  replaceProductImage,
  type ProductImageDb,
  type ProductImageRecord,
  type ProductImageStore,
} from "../lib/product-image-binding";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");
const JPEG = { mime: "image/jpeg", ext: "jpg" } as unknown as DetectedImage;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

/** A fake database and storage that write what they do into one log, so the order of steps can be checked. */
function fakes(product: ProductImageRecord | null, options: { saveFails?: boolean; removeFails?: boolean } = {}) {
  const log: string[] = [];
  const db: ProductImageDb = {
    find: async () => product,
    save: async (_id, image) => {
      if (options.saveFails) throw new Error("db down");
      log.push(`save ${image?.path ?? "null"}`);
    },
  };
  const store: ProductImageStore = {
    upload: async () => {
      log.push("upload");
      return { url: "https://files.example/product-images/products/new.jpg", path: "products/new.jpg" };
    },
    remove: async (p) => {
      log.push(`remove ${p}`);
      if (options.removeFails) throw new Error("storage down");
    },
  };
  return { db, store, log };
}

const WITH_OLD: ProductImageRecord = { id: "p1", imageUrl: "https://files.example/product-images/products/old.jpg", imagePath: "products/old.jpg" };
const WITHOUT: ProductImageRecord = { id: "p1", imageUrl: null, imagePath: null };

(async () => {
  await test("photo: the file is uploaded, then the address saved, then the old file removed", async () => {
    const { db, store, log } = fakes(WITH_OLD);
    const saved = await replaceProductImage(db, store, "p1", BYTES, JPEG);
    assert.equal(saved.path, "products/new.jpg");
    assert.deepEqual(log, ["upload", "save products/new.jpg", "remove products/old.jpg"]);
  });

  await test("photo: a product with no photo yet has nothing to remove", async () => {
    const { db, store, log } = fakes(WITHOUT);
    await replaceProductImage(db, store, "p1", BYTES, JPEG);
    assert.deepEqual(log, ["upload", "save products/new.jpg"]);
  });

  await test("photo: if the database save fails, the new file is deleted and the old photo stays", async () => {
    const { db, store, log } = fakes(WITH_OLD, { saveFails: true });
    await assert.rejects(() => replaceProductImage(db, store, "p1", BYTES, JPEG), /db down/);
    assert.deepEqual(log, ["upload", "remove products/new.jpg"]);
  });

  await test("photo: an unknown product uploads nothing", async () => {
    const { db, store, log } = fakes(null);
    await assert.rejects(() => replaceProductImage(db, store, "missing", BYTES, JPEG), ProductImageNotFound);
    assert.deepEqual(log, []);
  });

  await test("photo: a failed cleanup of the old file does not fail the upload", async () => {
    const { db, store } = fakes(WITH_OLD, { removeFails: true });
    const saved = await replaceProductImage(db, store, "p1", BYTES, JPEG);
    assert.equal(saved.url, "https://files.example/product-images/products/new.jpg");
  });

  await test("photo: remove clears the address first, then deletes the file", async () => {
    const { db, store, log } = fakes(WITH_OLD);
    await removeProductImage(db, store, "p1");
    assert.deepEqual(log, ["save null", "remove products/old.jpg"]);
    await assert.rejects(() => removeProductImage(fakes(null).db, store, "missing"), ProductImageNotFound);
  });

  await test("bucket script: public bucket with the same limits as the app and public read as the only policy", () => {
    const sql = read("supabase/storage-product-images.sql");
    const code = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.ok(code.includes(`('product-images', 'product-images', true, ${MAX_IMAGE_BYTES}`), "bucket id, public, size limit");
    for (const type of ALLOWED_IMAGE_TYPES) assert.ok(code.includes(`'${type}'`), `${type} is allowed`);
    assert.ok(code.includes("on conflict (id) do update"), "the bucket step can run again");
    assert.match(code, /create policy "product-images: public read"[\s\S]*?for select[\s\S]*?to public[\s\S]*?bucket_id = 'product-images'/);
    assert.equal((code.match(/create policy/g) ?? []).length, 1, "public read is the only policy created");
    assert.ok(!/for\s+(insert|update|delete|all)\b/i.test(code), "no write policy of any kind");
    assert.ok(!/to\s+(authenticated|anon)\b/i.test(code), "nothing is granted to authenticated or anon");
    for (const old of ["authenticated insert", "authenticated update"]) {
      assert.ok(code.includes(`drop policy if exists "product-images: ${old}" on storage.objects;`), `the old ${old} policy is dropped`);
    }
    assert.equal((code.match(/drop policy if exists/g) ?? []).length, 3, "public read is recreated and both old write policies are dropped");
    assert.equal(MAX_IMAGE_BYTES, 150_000, "the bucket limit is 150 KB");
  });

  await test("bucket script: it deletes no photo and says plainly that only the server can write", () => {
    const sql = read("supabase/storage-product-images.sql");
    const code = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.ok(!/delete\s+from|truncate|drop\s+table|drop\s+schema|alter\s+table/i.test(code));
    assert.ok(sql.includes("service-role key") && sql.includes("NOBODY BUT THE SERVER CAN WRITE"));
  });

  await test("filter: values from the address are cleaned", () => {
    assert.deepEqual(parseProductFilter({ q: "  LW265TS ", category: "ts", color: "03", status: "active", image: "missing" }), {
      q: "LW265TS",
      category: "TS",
      color: "03",
      status: "active",
      image: "missing",
    });
    assert.deepEqual(parseProductFilter({ category: "TS; DROP", color: "0 0", status: "weird", image: "x" }), {
      q: "",
      category: "",
      color: "",
      status: "",
      image: "",
    });
    assert.equal(parseProductFilter({ q: "a".repeat(300) }).q.length, 100);
  });

  await test("filter: nothing chosen means every product", () => {
    assert.deepEqual(productWhere(parseProductFilter({})), {});
  });

  await test("filter: a style SKU finds the style by name or by any of its variant SKUs, ignoring case", () => {
    const where = productWhere(parseProductFilter({ q: "LW265TS" }));
    assert.deepEqual(where.OR?.[0], { name: { contains: "LW265TS", mode: "insensitive" } });
    assert.deepEqual(where.OR?.[3], { variants: { some: { sku: { contains: "LW265TS", mode: "insensitive" } } } });
  });

  await test("filter: category code, colour and active state combine with the style search", () => {
    const where = productWhere(parseProductFilter({ category: "TS", color: "03", status: "inactive", q: "LW" }));
    assert.deepEqual(where.category, { code: "TS" });
    assert.deepEqual(where.variants, { some: { colorRef: { code: "03" } } });
    assert.equal(where.isActive, false);
    assert.ok(Array.isArray(where.OR));
  });

  await test("filter: the missing-photo filter is not part of the where clause, because it depends on the colour photos", () => {
    const where = productWhere(parseProductFilter({ image: "missing" }));
    assert.equal("imageUrl" in where, false);
  });

  await test("structure: the photo routes are manager-only, and the upload route shares the photo check", () => {
    const route = read("app/api/admin/products/[id]/image/route.ts");
    assert.equal((route.match(/await requireManager\(\)/g) ?? []).length, 2, "POST and DELETE both require a manager");
    assert.ok(route.includes("replaceProductImage") && route.includes("removeProductImage"));
    const upload = read("app/api/admin/uploads/product-image/route.ts");
    assert.ok(upload.includes("readImageUpload") && !upload.includes("detectImageType"));
  });

  await test("structure: the photo field saves to the product at once and shows loading, saved and error states", () => {
    const field = read("components/admin/product-image-field.tsx");
    assert.ok(field.includes("saveUrl") && field.includes("fetch(saveUrl"));
    assert.ok(read("components/admin/product-form.tsx").includes("/api/admin/products/${initial.id}/image"));
    for (const kind of ['kind: "uploading"', 'kind: "saved"', 'kind: "error"', 'kind: "removing"']) assert.ok(field.includes(kind), kind);
    assert.ok(field.includes("router.refresh()"));
  });

  await test("structure: the product list filters live, with no Apply button", () => {
    const page = read("app/admin/products/page.tsx");
    assert.ok(page.includes("<ProductFilters") && !page.includes("<form"));
    const filters = read("components/admin/product-filters.tsx");
    assert.ok(filters.includes("startTransition") && filters.includes("router.replace"));
    assert.ok(!filters.includes('type="submit"'));
  });

  console.log(`\n${passed} photo-and-filter groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
