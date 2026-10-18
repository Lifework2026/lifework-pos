// Grouping variants into one card per style: the colour and size lists, the options badge, the default pick, and the
// shape handed to the cart. Run with: npx tsx tests/style-group.test.ts
import assert from "node:assert/strict";
import {
  compareSizes,
  defaultSelection,
  priceRange,
  styleBadge,
  styleColors,
  styleSizes,
  cardImage,
  toVariantSummary,
  totalStock,
  variantsOfColor,
} from "../lib/catalog/style-group";
import type { StyleSummary, StyleVariant } from "../lib/pos-types";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

let n = 0;
const v = (colorId: string, color: string, size: string, stock: number, price = "1290.00", imageUrl: string | null = null, ownPhoto = false): StyleVariant => ({
  id: `v${++n}`,
  sku: `SKU-${colorId}-${size}`,
  barcode: `BC-${colorId}-${size}`,
  size,
  colorId,
  color,
  price,
  stockQuantity: stock,
  imageUrl,
  ownPhoto,
});

const style = (variants: StyleVariant[]): StyleSummary => ({
  id: "p1",
  name: "LW265TS990",
  nameTh: null,
  brand: "Lifework",
  imageUrl: "https://files.example/style.webp",
  promoTag: null,
  categoryId: "c1",
  variants,
});

test("badge: colours are counted, and a single size is named while several are counted", () => {
  assert.equal(styleBadge([v("a", "BLACK", "F", 1), v("b", "WHITE", "F", 1)]), "2 COLORS · F");
  assert.equal(styleBadge([v("a", "BLACK", "S", 1), v("a", "BLACK", "M", 1), v("a", "BLACK", "L", 1), v("a", "BLACK", "XL", 1), v("a", "BLACK", "XS", 1)]), "1 COLOR · 5 SIZES");
  assert.equal(styleBadge([v("a", "BLACK", "240", 1)]), "1 COLOR · 240");
});

test("sizes: garment sizes in order, then free size, and shoe numbers by value", () => {
  assert.deepEqual(["XL", "S", "F", "M", "XS", "L"].sort(compareSizes), ["XS", "S", "M", "L", "XL", "F"]);
  assert.deepEqual(["270", "230", "250"].sort(compareSizes), ["230", "250", "270"]);
  assert.deepEqual(["2XL", "XL", "3XL"].sort(compareSizes), ["XL", "2XL", "3XL"]);
  assert.deepEqual(styleSizes([v("a", "X", "M", 1), v("b", "Y", "M", 1), v("a", "X", "S", 1)]), ["S", "M"]);
});

test("colours: each once, by name, with their stock and the first photo found", () => {
  const colors = styleColors([v("w", "WHITE", "S", 2, "1", "w.webp"), v("b", "BLACK", "S", 0), v("w", "WHITE", "M", 3)]);
  assert.deepEqual(colors.map((c) => c.name), ["BLACK", "WHITE"]);
  assert.equal(colors[1].stock, 5);
  assert.equal(colors[1].imageUrl, "w.webp");
  assert.equal(colors[0].stock, 0);
});

test("colours: negative stock never reduces a total", () => {
  assert.equal(totalStock([v("a", "X", "S", -3), v("a", "X", "M", 4)]), 4);
});

test("price: a style with one price shows it; different prices give a range", () => {
  assert.deepEqual(priceRange([v("a", "X", "S", 1, "1290.00"), v("a", "X", "M", 1, "1290.00")]), { min: 1290, max: 1290 });
  assert.deepEqual(priceRange([v("a", "X", "S", 1, "1290.00"), v("a", "X", "M", 1, "1490.00")]), { min: 1290, max: 1490 });
});

test("variants of a colour: only that colour, in size order", () => {
  const all = [v("a", "X", "L", 1), v("b", "Y", "S", 1), v("a", "X", "S", 1), v("a", "X", "M", 1)];
  assert.deepEqual(variantsOfColor(all, "a").map((x) => x.size), ["S", "M", "L"]);
});

test("default pick: the first colour with stock; the size too only when that colour has one size", () => {
  const stocked = [v("b", "BLACK", "F", 0), v("w", "WHITE", "F", 4)];
  const pick = defaultSelection(stocked);
  assert.equal(pick.colorId, "w");
  assert.equal(pick.variantId, stocked[1].id);

  const sized = [v("w", "WHITE", "S", 2), v("w", "WHITE", "M", 2)];
  assert.deepEqual(defaultSelection(sized), { colorId: "w", variantId: null });
});

test("default pick: with no stock anywhere the first colour is shown, so the options can still be inspected", () => {
  const none = [v("b", "BLACK", "F", 0), v("w", "WHITE", "F", 0)];
  assert.equal(defaultSelection(none).colorId, "b");
  assert.deepEqual(defaultSelection([]), { colorId: null, variantId: null });
});

test("cart shape: the picked variant looks exactly like a barcode lookup result, with its own colour photo and price", () => {
  const variant = v("w", "WHITE", "M", 3, "790.00", "white.webp");
  const summary = toVariantSummary(style([variant]), variant);
  assert.equal(summary.id, variant.id);
  assert.equal(summary.price, "790.00");
  assert.equal(summary.stockQuantity, 3);
  assert.deepEqual(summary.product, { id: "p1", name: "LW265TS990", nameTh: null, imageUrl: "white.webp", promoTag: null, brand: "Lifework", categoryId: "c1" });
});

test("card photo: a colour photo of its own beats the supplier style photo, preferring a colour in stock", () => {
  const withOwn = style([v("b", "BLACK", "S", 0, "1", "black.webp", true), v("w", "WHITE", "S", 5, "1", "white.webp", true)]);
  assert.equal(cardImage(withOwn), "white.webp", "the colour in stock wins");
  const none = style([v("b", "BLACK", "S", 0, "1", "black.webp", true), v("w", "WHITE", "S", 0, "1", "white.webp", true)]);
  assert.equal(cardImage(none), "black.webp", "with nothing in stock, the first colour by name");
});

test("card photo: with no colour photo it is the style photo, then any photo, then none", () => {
  assert.equal(cardImage(style([v("a", "X", "S", 1, "1", "style.webp", false)])), "https://files.example/style.webp");
  const noStyle = { ...style([v("a", "X", "S", 1, "1", "fallback.webp", false)]), imageUrl: null };
  assert.equal(cardImage(noStyle), "fallback.webp");
  assert.equal(cardImage({ ...style([v("a", "X", "S", 1)]), imageUrl: null }), null);
});

console.log(`\n${passed} style-group tests passed`);
