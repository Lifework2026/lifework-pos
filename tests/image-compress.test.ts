// Photo compression: the size and quality search, the 150 KB limit on the server, and the way the browser applies it.
// Run with: npx tsx tests/image-compress.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compressToTarget, fitWithin, formatBytes, PhotoCompressionError, TARGET_IMAGE_BYTES, MAX_SIDE_PX } from "../lib/image-compress";
import { readImageUpload } from "../lib/image-upload";
import { detectImageType, MAX_IMAGE_BYTES } from "../lib/image-type";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

/** A pretend encoder: the file size follows the pixel count and the quality, like a real photo does. */
function fakeEncoder(bytesPerPixelAtFullQuality: number) {
  const calls: Array<{ width: number; height: number; quality: number }> = [];
  const encode = async (width: number, height: number, quality: number) => {
    calls.push({ width, height, quality });
    return { size: Math.round(width * height * quality * bytesPerPixelAtFullQuality), type: "image/webp" };
  };
  return { encode, calls };
}

function uploadRequest(bytes: Uint8Array, name = "photo.webp", type = "image/webp"): Request {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  return new Request("http://localhost/upload", { method: "POST", body: form });
}

(async () => {
  await test("limit: a stored photo is strictly under 150 KB and the browser aims below that", () => {
    assert.equal(MAX_IMAGE_BYTES, 150_000);
    assert.ok(TARGET_IMAGE_BYTES < MAX_IMAGE_BYTES);
    assert.equal(MAX_SIDE_PX, 800);
  });

  await test("size: a big photo is scaled to 800 px on the long side, keeping its proportions", () => {
    assert.deepEqual(fitWithin(4000, 3000, 800), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(3000, 4000, 800), { width: 600, height: 800 });
  });

  await test("size: a small photo is never enlarged", () => {
    assert.deepEqual(fitWithin(400, 300, 800), { width: 400, height: 300 });
  });

  await test("size: a very thin photo keeps at least one pixel on the short side", () => {
    assert.deepEqual(fitWithin(8000, 3, 800), { width: 800, height: 1 });
  });

  await test("search: a photo that already fits is encoded once, at the best quality", async () => {
    const { encode, calls } = fakeEncoder(0.1);
    const result = await compressToTarget(encode, { width: 600, height: 400 });
    assert.equal(calls.length, 1);
    assert.equal(result.quality, 0.82);
    assert.ok(result.encoded.size <= TARGET_IMAGE_BYTES);
  });

  await test("search: a heavy photo gives up quality first and keeps the full 800 px", async () => {
    const { encode, calls } = fakeEncoder(0.5);
    const result = await compressToTarget(encode, { width: 4000, height: 3000 });
    assert.ok(result.encoded.size <= TARGET_IMAGE_BYTES);
    assert.equal(Math.max(result.width, result.height), 800);
    assert.ok(result.quality < 0.82);
    assert.ok(calls.every((c) => c.width === 800), "no shrinking was needed");
  });

  await test("search: when quality alone is not enough the picture is made smaller", async () => {
    const { encode } = fakeEncoder(1.2);
    const result = await compressToTarget(encode, { width: 4000, height: 3000 });
    assert.ok(result.encoded.size <= TARGET_IMAGE_BYTES);
    assert.ok(Math.max(result.width, result.height) < 800);
  });

  await test("search: the result is never over the target, whatever the photo", async () => {
    for (const heaviness of [0.05, 0.3, 0.9, 1.5]) {
      const { encode } = fakeEncoder(heaviness);
      const result = await compressToTarget(encode, { width: 3000, height: 2000 });
      assert.ok(result.encoded.size <= TARGET_IMAGE_BYTES, `heaviness ${heaviness}`);
      assert.ok(result.encoded.size < MAX_IMAGE_BYTES);
    }
  });

  await test("search: a photo that cannot get small enough is refused, not uploaded too large", async () => {
    const { encode } = fakeEncoder(1000);
    await assert.rejects(
      () => compressToTarget(encode, { width: 4000, height: 3000 }),
      (err: unknown) => err instanceof PhotoCompressionError && err.code === "TOO_COMPLEX",
    );
  });

  await test("search: a browser that cannot encode is reported, not guessed", async () => {
    await assert.rejects(
      () => compressToTarget(async () => null, { width: 800, height: 600 }),
      (err: unknown) => err instanceof PhotoCompressionError && err.code === "ENCODE_FAILED",
    );
  });

  await test("format: sizes read in KB and MB", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(96_400), "96 KB");
    assert.equal(formatBytes(4_200_000), "4.2 MB");
  });

  await test("server: a photo over 150 KB is refused with 413 whatever the browser did", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const result = await readImageUpload(uploadRequest(big));
    assert.ok("response" in result);
    assert.equal(result.response.status, 413);
    assert.match(JSON.stringify(await result.response.json()), /150 KB/);
  });

  await test("server: a WebP photo at the limit is accepted and read as WebP from its bytes", async () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const result = await readImageUpload(uploadRequest(bytes));
    assert.ok("image" in result);
    assert.deepEqual(result.image, { mime: "image/webp", ext: "webp" });
    assert.deepEqual(detectImageType(bytes), { mime: "image/webp", ext: "webp" });
  });

  await test("server: a file that is not a photo is refused even when small and named .webp", async () => {
    const result = await readImageUpload(uploadRequest(new TextEncoder().encode("not an image at all")));
    assert.ok("response" in result);
    assert.equal(result.response.status, 415);
  });

  await test("structure: the browser always re-encodes (no skip shortcut) and asks for WebP", () => {
    const client = read("lib/client-image.ts");
    assert.ok(client.includes('"image/webp"') && client.includes("compressToTarget"));
    assert.ok(!client.includes("SKIP_RESIZE"), "every photo is compressed, however small");
  });

  await test("structure: the photo field shows a shrinking step and the before and after size", () => {
    const field = read("components/admin/product-image-field.tsx");
    assert.ok(field.includes('kind: "compressing"') && field.includes("img.compressing"));
    assert.ok(field.includes("img.compressed") && field.includes("formatBytes"));
  });

  await test("structure: the bucket limit comes from the same constant as the app limit", () => {
    assert.ok(read("lib/storage.ts").includes("file_size_limit: MAX_IMAGE_BYTES"));
  });

  console.log(`\n${passed} compression groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
