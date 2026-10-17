// Style photos taken from a supplier sheet: which picture a style gets, which products get it, and the real WebP
// encoding with sharp. Run with: npx tsx tests/style-photos.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { decideStyle, LOW_RESOLUTION_PX, normalizeStyle, planStylePhotos, STYLE_CODE, type SheetRow } from "../lib/catalog/style-photos";
import { compressToTarget } from "../lib/image-compress";
import { detectImageType, MAX_IMAGE_BYTES } from "../lib/image-type";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

const row = (n: number, style: string, color: string, image: number | null, barcode = `${style}${color}S`): SheetRow => ({
  row: n,
  style,
  colorCode: color,
  barcode,
  description: "UNI) tie-dye graphic TS",
  image,
});

(async () => {
  await test("style code: brand, season, category and model; totals and notes do not match", () => {
    for (const ok of ["LW262TS116", "LW252WL652", "LW235CP415", "LW265BG902"]) assert.ok(STYLE_CODE.test(ok), ok);
    for (const bad of ["100", "", "TOTAL", "LW262TS11", "lw262ts116", "LW262TS1166"]) assert.ok(!STYLE_CODE.test(bad), bad);
    assert.equal(normalizeStyle("  lw262ts116 "), "LW262TS116");
    assert.equal(normalizeStyle(100), "");
    assert.equal(normalizeStyle({ formula: "A1" }), "");
  });

  await test("plan: every colour and size row of a style gives one style photo, the sharpest copy the sheet has", () => {
    const images = [
      { width: 79, height: 77 },
      { width: 91, height: 89 },
      { width: 74, height: 72 },
    ];
    const plan = planStylePhotos(
      [row(2, "LW262TS116", "11", 0), row(3, "LW262TS116", "11", 1), row(4, "LW262TS116", "23", 2), row(5, "LW262TS116", "34", null)],
      images,
    );
    assert.equal(plan.picks.length, 1);
    assert.equal(plan.picks[0].image, 1, "the 91x89 copy is the largest");
    assert.deepEqual(plan.picks[0].colors, ["11", "23", "34"]);
    assert.equal(plan.picks[0].rows, 4);
    assert.equal(plan.picks[0].barcodes.length, 4);
  });

  await test("plan: styles stay separate, in the order the sheet lists them", () => {
    const plan = planStylePhotos([row(2, "LW262TS116", "11", 0), row(3, "LW265TS990", "35", 1), row(4, "LW262TS116", "23", 0)], [
      { width: 100, height: 100 },
      { width: 300, height: 300 },
    ]);
    assert.deepEqual(plan.picks.map((p) => p.style), ["LW262TS116", "LW265TS990"]);
    assert.equal(plan.picks[0].rows, 2);
  });

  await test("plan: a style with no picture on any row is reported, not skipped silently", () => {
    const plan = planStylePhotos([row(2, "LW262TS116", "11", null), row(3, "LW262TS116", "23", null)], []);
    assert.deepEqual(plan.picks, []);
    assert.deepEqual(plan.withoutImage, ["LW262TS116"]);
  });

  await test("plan: totals, notes and blank rows are ignored and listed", () => {
    const plan = planStylePhotos([row(2, "LW262TS116", "11", 0), row(3, "100", "", null, ""), row(4, "", "", null, "")], [{ width: 100, height: 100 }]);
    assert.equal(plan.picks.length, 1);
    assert.deepEqual(plan.ignored, [{ row: 3, value: "100" }], "a blank row is not worth mentioning");
  });

  await test("plan: small pictures are flagged as low resolution", () => {
    const plan = planStylePhotos([row(2, "LW262TS116", "11", 0), row(3, "LW265TS990", "35", 1)], [
      { width: LOW_RESOLUTION_PX - 1, height: 80 },
      { width: LOW_RESOLUTION_PX, height: 80 },
    ]);
    assert.deepEqual(plan.picks.map((p) => p.lowResolution), [true, false]);
  });

  await test("decide: a style with no product in the system is reported as not there yet", () => {
    assert.deepEqual(decideStyle([], false), { kind: "not-in-system" });
  });

  await test("decide: products without a photo get it", () => {
    assert.deepEqual(decideStyle([{ productId: "p1", hasPhoto: false }], false), { kind: "set", productIds: ["p1"] });
  });

  await test("decide: a photo someone already uploaded is never overwritten unless replace is chosen", () => {
    const matches = [
      { productId: "p1", hasPhoto: true },
      { productId: "p2", hasPhoto: false },
    ];
    assert.deepEqual(decideStyle(matches, false), { kind: "set", productIds: ["p2"] });
    assert.deepEqual(decideStyle([matches[0]], false), { kind: "skip-has-photo", productIds: ["p1"] });
    assert.deepEqual(decideStyle(matches, true), { kind: "set", productIds: ["p1", "p2"] });
  });

  await test("encode: a large noisy picture becomes a WebP of at most 800 px and under 150 KB", async () => {
    const noise = Buffer.alloc(2400 * 1800 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const source = await sharp(noise, { raw: { width: 2400, height: 1800, channels: 3 } }).png().toBuffer();
    const { encoded, width, height } = await compressToTarget(
      async (w, h, quality) => {
        const buffer = await sharp(source).resize(w, h, { fit: "fill" }).webp({ quality: Math.round(quality * 100) }).toBuffer();
        return { size: buffer.length, type: "image/webp", buffer };
      },
      { width: 2400, height: 1800 },
    );
    assert.ok(encoded.size < MAX_IMAGE_BYTES, `${encoded.size} bytes`);
    assert.ok(Math.max(width, height) <= 800);
    assert.deepEqual(detectImageType(new Uint8Array(encoded.buffer)), { mime: "image/webp", ext: "webp" });
  });

  await test("encode: a small picture is kept at its own size, never enlarged", async () => {
    const source = await sharp({ create: { width: 79, height: 77, channels: 3, background: "#cccccc" } }).png().toBuffer();
    const { width, height } = await compressToTarget(
      async (w, h, quality) => {
        const buffer = await sharp(source).resize(w, h, { fit: "fill" }).webp({ quality: Math.round(quality * 100) }).toBuffer();
        return { size: buffer.length, type: "image/webp", buffer };
      },
      { width: 79, height: 77 },
    );
    assert.deepEqual({ width, height }, { width: 79, height: 77 });
  });

  await test("script: preview by default, writes only with --apply, never replaces without --replace, matches by barcode", () => {
    const script = read("scripts/import-style-photos.ts");
    assert.ok(script.includes('args.includes("--apply")') && script.includes('args.includes("--replace")'));
    assert.ok(script.indexOf("if (!apply)") < script.indexOf("replaceProductImage(db, store"), "the preview returns before any upload");
    assert.ok(script.includes("barcode: { in: codes }") && script.includes("sku: { in: codes }"));
    assert.ok(script.includes("PRODUCT_IMAGE_SET") && script.includes("import-style-photos"), "each saved photo is audited");
    assert.ok(script.includes("replaceProductImage"), "it uses the same save-and-rollback rules as the admin page");
  });

  console.log(`\n${passed} style-photo groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
