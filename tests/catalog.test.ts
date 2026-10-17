/**
 * Tests for spreadsheet parsing, import validation, image checks and the storage client.
 * Run with: npm test
 */
import assert from "node:assert/strict";
import { parseImportTable, TEMPLATE_HEADER } from "../lib/catalog/import";
import { detectImageType } from "../lib/image-type";
import { slugify } from "../lib/slug";
import { buildXlsx, parseCsv, parseXlsx, toCsv } from "../lib/tabular";
import {
  ensureBucket,
  getStorageConfig,
  isManagedImageUrl,
  StorageError,
  uploadProductImage,
  type StorageConfig,
} from "../lib/storage";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const header = ["SKU", "Name", "Category", "Size", "Price", "Stock"];

(async () => {
  // ---------------- CSV
  await test("csv: quoted fields, escaped quotes, embedded commas and line breaks", () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n');
    assert.deepEqual(rows, [
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
    ]);
  });

  await test("csv: byte-order mark, LF endings and blank rows are handled", () => {
    const rows = parseCsv("﻿SKU,Name\nA1,Tee\n\n,\nB2,Shirt\n");
    assert.deepEqual(rows, [
      ["SKU", "Name"],
      ["A1", "Tee"],
      ["B2", "Shirt"],
    ]);
  });

  await test("csv: semicolon and tab delimiters are detected", () => {
    assert.deepEqual(parseCsv("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  });

  await test("csv: Thai text survives", () => {
    assert.deepEqual(parseCsv("ชื่อ,ราคา\nเสื้อยืด,390"), [["ชื่อ", "ราคา"], ["เสื้อยืด", "390"]]);
  });

  await test("csv export: formula-looking text is neutralised, numbers and Thai are untouched", () => {
    const out = toCsv(["name", "amount"], [
      ["=HYPERLINK(\"http://x\")", -100.5],
      ["+66 81", "-250.00"],
      ["@SUM(A1)", 5],
      ["-cmd|' /C calc'!A0", 1],
      ["เสื้อเชิ้ต", 0],
    ]);
    const lines = out.replace("﻿", "").trim().split("\r\n");
    assert.equal(lines[1], "\"'=HYPERLINK(\"\"http://x\"\")\",-100.5");
    assert.equal(lines[2], "'+66 81,-250.00");
    assert.equal(lines[3], "'@SUM(A1),5");
    assert.ok(lines[4].startsWith("'-cmd"));
    assert.equal(lines[5], "เสื้อเชิ้ต,0");
  });

  // ---------------- XLSX round trip
  await test("xlsx: build then parse returns the same table, keeping text and Thai", async () => {
    const table = [
      ["TEE-1", "เสื้อยืด", "00123456", "390.50"],
      ["TEE-2", "Plain Tee", "8851234567890", "100"],
    ];
    const buffer = await buildXlsx("Products", ["SKU", "Name", "Barcode", "Price"], table, { textColumns: [0, 2] });
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const parsed = await parseXlsx(arrayBuffer);
    assert.deepEqual(parsed[0], ["SKU", "Name", "Barcode", "Price"]);
    assert.equal(parsed[1][1], "เสื้อยืด");
    assert.equal(parsed[1][2], "00123456");
    assert.equal(parsed[2][2], "8851234567890");
  });

  // ---------------- Import validation (Template A, keyed by master-data codes)
  await test("import: the downloadable template header parses cleanly with an example row", () => {
    const example = ["LW265TS99035XL", "LW-TEE-M", "เสื้อยืด", "Cotton Tee", "SR", "COL-BLK", "M", "390", "180", "10", "HOT"];
    const result = parseImportTable([TEMPLATE_HEADER, example]);
    assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
    assert.equal(result.rows[0].priceSatang, 39_000);
    assert.equal(result.rows[0].categoryCode, "SR");
    assert.equal(result.rows[0].colorCode, "COL-BLK");
    assert.equal(result.rows[0].costSatang, 18_000);
    assert.equal(result.rows[0].promoTag, "HOT");
  });

  await test("import: Category_Code and Color_Code are required columns", () => {
    const result = parseImportTable([["SKU", "Name_EN", "Size", "Price"], ["LW-1", "Tee", "M", "390"]]);
    assert.ok(result.issues.some((i) => /Category_Code/.test(i.message)), "category code column");
    assert.ok(result.issues.some((i) => /Color_Code/.test(i.message)), "colour code column");
  });

  await test("import: a row without a category or colour code is refused with the line number", () => {
    const result = parseImportTable([
      ["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price"],
      ["LW-1", "Tee", "", "COL-BLK", "M", "390"],
      ["LW-2", "Tee", "SR", "", "L", "390"],
    ]);
    assert.ok(result.issues.some((i) => i.line === 2 && /Category_Code is required/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 3 && /Color_Code is required/.test(i.message)));
  });

  await test("import: codes are accepted in lower case and stored in upper case", () => {
    const result = parseImportTable([
      ["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price"],
      ["LW-1", "Tee", "sr", "col-blk", "M", "390"],
    ]);
    assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
    assert.equal(result.rows[0].categoryCode, "SR");
    assert.equal(result.rows[0].colorCode, "COL-BLK");
  });

  await test("import: a malformed code is refused with the rule", () => {
    const result = parseImportTable([
      ["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price"],
      ["LW-1", "Tee", "shirts!", "COL-BLK", "M", "390"],
    ]);
    assert.ok(result.issues.some((i) => /Category_Code 'SHIRTS!'/.test(i.message)));
  });

  await test("import: the same product must not be listed under two categories", () => {
    const result = parseImportTable([
      ["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price"],
      ["LW-1", "Tee", "SR", "COL-BLK", "M", "390"],
      ["LW-2", "Tee", "WL", "COL-BLK", "L", "390"],
    ]);
    assert.ok(result.issues.some((i) => i.line === 3 && /Use one category/.test(i.message)));
  });

  await test("import: duplicate SKUs and barcodes inside the file are caught", () => {
    const result = parseImportTable([
      ["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price", "Barcode"],
      ["LW-1", "Tee", "SR", "COL-BLK", "M", "390", "LW265TS99035XL"],
      ["LW-1", "Tee", "SR", "COL-BLK", "L", "390", "LW265TS99035XM"],
      ["LW-3", "Tee", "SR", "COL-BLK", "S", "390", "LW265TS99035XL"],
    ]);
    assert.ok(result.issues.some((i) => i.line === 3 && /SKU LW-1 is already on line 2/.test(i.message)));
    assert.ok(result.issues.some((i) => i.line === 4 && /already appears on line 2/.test(i.message)));
  });

  await test("import: the row limit is enforced", () => {
    const rows = Array.from({ length: 2001 }, (_, i) => [`S-${i}`, `P${i}`, "SR", "COL-BLK", "M", "10"]);
    const result = parseImportTable([["SKU", "Name_EN", "Category_Code", "Color_Code", "Size", "Price"], ...rows]);
    assert.equal(result.rows.length, 0);
    assert.match(result.issues[0].message, /limit is 2000/);
  });

  await test("slug: Latin names are readable, Thai names get a stable hash", () => {
    assert.equal(slugify("Basic Cotton Tee!"), "basic-cotton-tee");
    const thai = slugify("เสื้อยืด");
    assert.match(thai, /^item-[0-9a-f]{8}$/);
    assert.equal(thai, slugify("เสื้อยืด"));
    assert.notEqual(thai, slugify("กางเกง"));
  });

  // ---------------- Images
  await test("image: real file signatures are recognised and others rejected", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const script = new TextEncoder().encode("<script>alert(1)</script>");
    assert.equal(detectImageType(jpeg)?.ext, "jpg");
    assert.equal(detectImageType(png)?.ext, "png");
    assert.equal(detectImageType(webp)?.ext, "webp");
    assert.equal(detectImageType(gif), null);
    assert.equal(detectImageType(script), null);
    assert.equal(detectImageType(new Uint8Array([])), null);
  });

  // ---------------- Storage client (mocked network)
  const config: StorageConfig = { url: "https://proj.supabase.co", key: "service-key", bucket: "product-images" };

  await test("storage: configuration needs both URL and key", () => {
    assert.equal(getStorageConfig({ SUPABASE_URL: "https://x.supabase.co" }), null);
    assert.equal(getStorageConfig({ SUPABASE_SERVICE_ROLE_KEY: "k" }), null);
    const ok = getStorageConfig({ SUPABASE_URL: "https://x.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "k" });
    assert.deepEqual(ok, { url: "https://x.supabase.co", key: "k", bucket: "product-images" });
  });

  await test("storage: only our own bucket URLs count as managed images", () => {
    assert.equal(isManagedImageUrl(config, "https://proj.supabase.co/storage/v1/object/public/product-images/products/a.jpg"), true);
    assert.equal(isManagedImageUrl(config, "https://evil.example.com/a.jpg"), false);
    assert.equal(isManagedImageUrl(config, "https://proj.supabase.co/storage/v1/object/public/other-bucket/a.jpg"), false);
  });

  await test("storage: upload sends the right request and returns the public URL", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mock = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await uploadProductImage(config, new Uint8Array([1, 2, 3]), { mime: "image/png", ext: "png" }, mock);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer service-key");
    assert.equal(headers["Content-Type"], "image/png");
    assert.match(calls[0].url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/product-images\/products\/[0-9a-f-]+\.png$/);
    assert.match(result.url, /\/storage\/v1\/object\/public\/product-images\/products\/[0-9a-f-]+\.png$/);
    assert.match(result.path, /^products\/[0-9a-f-]+\.png$/);
  });

  await test("storage: a missing bucket is created and the upload retried once", async () => {
    const seen: string[] = [];
    let uploads = 0;
    const mock = (async (url: string, init: RequestInit) => {
      const method = init?.method ?? "GET";
      seen.push(`${method} ${url.replace(config.url, "")}`);
      if (url.includes("/object/product-images/")) {
        uploads += 1;
        return new Response("{}", { status: uploads === 1 ? 404 : 200 });
      }
      if (method === "GET") return new Response("{}", { status: 404 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await uploadProductImage(config, new Uint8Array([1]), { mime: "image/jpeg", ext: "jpg" }, mock);
    assert.ok(result.url.endsWith(".jpg"));
    assert.equal(uploads, 2);
    assert.ok(seen.some((entry) => entry === "POST /storage/v1/bucket"));
  });

  await test("storage: a failed upload raises a StorageError", async () => {
    const mock = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(
      () => uploadProductImage(config, new Uint8Array([1]), { mime: "image/jpeg", ext: "jpg" }, mock),
      (err: unknown) => err instanceof StorageError && err.code === "UPLOAD_FAILED",
    );
    const denied = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await assert.rejects(() => ensureBucket(config, denied), (err: unknown) => err instanceof StorageError && err.code === "BUCKET_FAILED");
  });

  console.log(`\n${passed} catalog test groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
