// Finding the colour photos on a product page picture. Run with: npx tsx tests/photo-detect.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findPhotoBlocks, padBox } from "../lib/catalog/photo-detect";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const W = 600;
const H = 800;
const page = () => new Uint8Array(W * H).fill(255);
function fill(grey: Uint8Array, x: number, y: number, w: number, h: number, value: number): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grey[j * W + i] = value;
}
/** Lines of "text": many separate small glyphs, like a paragraph. */
function paragraph(grey: Uint8Array, x: number, y: number, lines: number): void {
  for (let line = 0; line < lines; line++) {
    for (let g = 0; g < 28; g++) fill(grey, x + g * 11, y + line * 22, 7, 12, 30);
  }
}
/** A short word under a photo. */
function label(grey: Uint8Array, x: number, y: number): void {
  for (let g = 0; g < 5; g++) fill(grey, x + g * 9, y, 6, 11, 20);
}

test("two colour photos with their names under them: two boxes, the names left out", () => {
  const grey = page();
  paragraph(grey, 130, 120, 5);
  fill(grey, 110, 400, 120, 260, 90);
  fill(grey, 360, 400, 120, 260, 140);
  label(grey, 140, 690);
  label(grey, 390, 690);
  const boxes = findPhotoBlocks(grey, W, H);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes.map((b) => [b.x, b.y, b.width, b.height]), [[110, 400, 120, 260], [360, 400, 120, 260]]);
});

test("a front and a back view side by side are one colour, one box", () => {
  const grey = page();
  fill(grey, 100, 300, 180, 200, 110);
  fill(grey, 300, 300, 180, 200, 110);
  assert.equal(findPhotoBlocks(grey, W, H).length, 1);
});

test("two views stacked close together are one colour, one box", () => {
  const grey = page();
  fill(grey, 200, 200, 150, 160, 80);
  fill(grey, 200, 368, 150, 160, 80);
  assert.equal(findPhotoBlocks(grey, W, H).length, 1);
});

test("a paragraph, a title bar and a rule across the page are not photos", () => {
  const grey = page();
  paragraph(grey, 130, 200, 8);
  fill(grey, 200, 40, 160, 10, 0);
  fill(grey, 0, 760, W, 2, 0);
  assert.deepEqual(findPhotoBlocks(grey, W, H), []);
});

test("four colours in two rows come back in reading order", () => {
  const grey = page();
  fill(grey, 60, 100, 100, 200, 90);
  fill(grey, 340, 105, 100, 200, 90);
  fill(grey, 60, 450, 100, 200, 90);
  fill(grey, 340, 452, 100, 200, 90);
  const boxes = findPhotoBlocks(grey, W, H);
  assert.deepEqual(boxes.map((b) => [b.x, b.y]), [[60, 100], [340, 105], [60, 450], [340, 452]]);
});

test("a white garment on white, drawn as a soft outline, is still found", () => {
  const grey = page();
  for (let t = 0; t < 3; t++) {
    fill(grey, 150 + t, 300 + t, 200 - 2 * t, 2, 215);
    fill(grey, 150 + t, 500 - t, 200 - 2 * t, 2, 215);
    fill(grey, 150 + t, 300 + t, 2, 200 - 2 * t, 215);
    fill(grey, 350 - t, 300 + t, 2, 200 - 2 * t, 215);
  }
  assert.equal(findPhotoBlocks(grey, W, H).length, 1);
});

test("an empty page has no photos", () => {
  assert.deepEqual(findPhotoBlocks(page(), W, H), []);
});

test("padding grows a box a little and keeps it inside the picture", () => {
  const padded = padBox({ x: 5, y: 5, width: 100, height: 200 }, 300, 400);
  assert.equal(padded.x, 0);
  assert.equal(padded.y, 0);
  assert.ok(padded.width > 100 && padded.height > 200);
  const edge = padBox({ x: 250, y: 350, width: 50, height: 50 }, 300, 400);
  assert.ok(edge.x + edge.width <= 300 && edge.y + edge.height <= 400);
});

test("screen: a back office page, in the menu once, that reads the style, suggests boxes, offers only the style's colours, and saves through the colour photo route", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");
  const layout = read("app/admin/layout.tsx");
  assert.equal((layout.match(/\/admin\/photo-cutter/g) ?? []).length, 1);
  const cutter = read("components/admin/photo-cutter.tsx");
  assert.ok(cutter.includes("findPhotoBlocks(") && cutter.includes("parsePhotoName(") && cutter.includes("styleColors(style.variants)"));
  assert.ok(cutter.includes("/api/admin/products/${style.id}/colors/${box.colorId}/image") && cutter.includes("prepareProductPhoto("));
  assert.ok(cutter.includes("used.has(colour.colorId)"), "a colour can be used by one box only");
  assert.ok(read("app/admin/photo-cutter/page.tsx").includes("<PhotoCutter"));
});

console.log(`\n${passed} photo-detect tests passed`);
