// Cutting colour photos out of product pages from a plan. Run with: npx tsx tests/page-cut.test.ts
import assert from "node:assert/strict";
import { joinBoxes, padInBlank, parseCutPlan, splitBox, tighten, trimLabelBelow } from "../lib/catalog/page-cut";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const W = 400;
const H = 400;
const page = () => new Uint8Array(W * H).fill(255);
function fill(grey: Uint8Array, x: number, y: number, w: number, h: number, value = 40): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grey[j * W + i] = value;
}
const whole = { x: 0, y: 0, width: W, height: H };

test("the plan reads boxes, joined boxes, left and right halves, and the style photo", () => {
  const { lines, errors } = parseCutPlan("# a comment\nLW252TS405.jpg: 1L=40 1R=00\nLW252DS892.jpg: 1+2=48\nLW252TS110.webp: STYLE\nLW252KS811.jpg: 2=36 3=08\n");
  assert.deepEqual(errors, []);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].cuts, [{ parts: [{ box: 1, side: "L" }], colour: "40" }, { parts: [{ box: 1, side: "R" }], colour: "00" }]);
  assert.deepEqual(lines[1].cuts[0].parts.map((p) => p.box), [1, 2]);
  assert.equal(lines[2].style, true);
  assert.equal(lines[2].cuts.length, 0);
  assert.deepEqual(lines[3].cuts.map((c) => [c.parts[0].box, c.colour]), [[2, "36"], [3, "08"]]);
});

test("the plan reads top and bottom halves and a whole-picture colour", () => {
  const { lines, errors } = parseCutPlan(["LW1.jpg: 1B=91 2T=98", "LW2.jpg: ALL=40"].join("\n"));
  assert.deepEqual(errors, []);
  assert.deepEqual(lines[0].cuts.map((c) => c.parts[0].side), ["B", "T"]);
  assert.deepEqual(lines[1].cuts[0], { parts: [], colour: "40", whole: true });
  assert.ok(parseCutPlan("LW2.jpg: ALL=40 ALL=40").errors.some((e) => /given twice/.test(e)));
});

test("two photos stacked in one box are cut apart at the blank gap between them", () => {
  const grey = page();
  fill(grey, 100, 40, 120, 90);
  fill(grey, 90, 160, 140, 100);
  const box = tighten(grey, W, whole);
  assert.deepEqual(splitBox(grey, W, box, "T"), { x: 100, y: 40, width: 120, height: 90 });
  assert.deepEqual(splitBox(grey, W, box, "B"), { x: 90, y: 160, width: 140, height: 100 });
});

test("a plan that cannot be read says which line and why, and never guesses", () => {
  assert.ok(parseCutPlan("LW1.jpg: 1=40 1=40").errors.some((e) => /colour 40 is given twice/.test(e)));
  assert.ok(parseCutPlan("LW1.jpg: banana").errors.some((e) => /cannot read "banana"/.test(e)));
  assert.ok(parseCutPlan("LW1.jpg:").errors.some((e) => /nothing to cut/.test(e)));
  assert.ok(parseCutPlan("no colon here").errors.some((e) => /expected "file: tokens"/.test(e)));
  assert.ok(parseCutPlan("LW1.jpg: 1=40\nLW1.jpg: 2=00").errors.some((e) => /twice/.test(e)));
});

test("tighten shrinks a box to the ink inside it", () => {
  const grey = page();
  fill(grey, 100, 80, 60, 90);
  assert.deepEqual(tighten(grey, W, whole), { x: 100, y: 80, width: 60, height: 90 });
});

test("two photos found as one box are cut at the blank gap between them", () => {
  const grey = page();
  fill(grey, 50, 50, 100, 150);
  fill(grey, 230, 60, 110, 140);
  const box = tighten(grey, W, whole);
  assert.deepEqual(splitBox(grey, W, box, "L"), { x: 50, y: 50, width: 100, height: 150 });
  assert.deepEqual(splitBox(grey, W, box, "R"), { x: 230, y: 60, width: 110, height: 140 });
});

test("two photos that touch are cut where there is the least ink", () => {
  const grey = page();
  fill(grey, 50, 50, 150, 150);
  fill(grey, 200, 50, 150, 150);
  fill(grey, 195, 50, 10, 60, 255);
  const box = tighten(grey, W, whole);
  const left = splitBox(grey, W, box, "L");
  const right = splitBox(grey, W, box, "R");
  assert.ok(left.x === 50 && left.width >= 140 && left.width <= 160);
  assert.ok(right.x >= 190 && right.x + right.width === 350);
});

test("a colour name caught under a photo is cut off; a photo with no name is left alone", () => {
  const grey = page();
  fill(grey, 100, 50, 120, 200);
  fill(grey, 140, 262, 40, 10);
  const withName = tighten(grey, W, whole);
  assert.equal(withName.y + withName.height, 272);
  const result = trimLabelBelow(grey, W, withName);
  assert.equal(result.trimmed, true);
  assert.deepEqual(result.box, { x: 100, y: 50, width: 120, height: 200 });

  const plain = page();
  fill(plain, 100, 50, 120, 200);
  const unchanged = trimLabelBelow(plain, W, tighten(plain, W, whole));
  assert.equal(unchanged.trimmed, false);
  assert.deepEqual(unchanged.box, { x: 100, y: 50, width: 120, height: 200 });
});

test("stray dots under the colour name do not stop it being cut off", () => {
  const grey = page();
  fill(grey, 100, 50, 120, 200);
  fill(grey, 140, 262, 40, 10);
  fill(grey, 150, 274, 3, 1);
  fill(grey, 170, 275, 2, 1);
  const result = trimLabelBelow(grey, W, tighten(grey, W, whole));
  assert.equal(result.trimmed, true);
  assert.deepEqual(result.box, { x: 100, y: 50, width: 120, height: 200 });
});

test("a hat cord running to the bottom is not mistaken for a name", () => {
  const grey = page();
  fill(grey, 60, 50, 180, 80);
  fill(grey, 148, 130, 3, 150);
  const box = tighten(grey, W, whole);
  assert.equal(trimLabelBelow(grey, W, box).trimmed, false);
});

test("a cord and its toggle hanging from the photo stay when the colour name under them is cut off", () => {
  const grey = page();
  fill(grey, 60, 50, 180, 80);
  fill(grey, 148, 130, 3, 100);
  fill(grey, 145, 230, 9, 10);
  fill(grey, 130, 262, 40, 10);
  const result = trimLabelBelow(grey, W, tighten(grey, W, whole));
  assert.equal(result.trimmed, true);
  assert.equal(result.box.y + result.box.height, 240);
});

test("a long band at the bottom is part of the photo, not a name", () => {
  const grey = page();
  fill(grey, 100, 50, 120, 100);
  fill(grey, 100, 170, 120, 90);
  const box = tighten(grey, W, whole);
  assert.equal(trimLabelBelow(grey, W, box).trimmed, false);
});

test("the margin grows through blank space only, so a colour name just under the photo stays out", () => {
  const grey = page();
  fill(grey, 100, 50, 120, 200);
  fill(grey, 140, 258, 40, 10);
  const box = tighten(grey, W, { x: 0, y: 0, width: W, height: 255 });
  const padded = padInBlank(grey, W, H, box, 0.05);
  assert.equal(padded.y + padded.height, 258, "stops where the name starts");
  assert.equal(padded.x, 100 - 10, "the free sides get the whole margin (5% of the longer side)");
  assert.equal(padded.width, 120 + 20);
  const alone = padInBlank(grey, W, H, { x: 100, y: 50, width: 120, height: 100 }, 0.05);
  assert.equal(alone.y, 50 - 6);
});

test("joining boxes gives the box that holds them all", () => {
  assert.deepEqual(joinBoxes([{ x: 10, y: 20, width: 30, height: 40 }, { x: 100, y: 25, width: 30, height: 50 }]), { x: 10, y: 20, width: 120, height: 55 });
});

console.log(`\n${passed} page-cut tests passed`);
