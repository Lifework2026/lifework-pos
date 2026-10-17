// The cashier screen's layout rules, checked in the source: a one-row category strip, a compact auto-fill grid, a muted
// (not faded) sold-out card, a large total and a strong pay button, and tokens for the grey canvas and tabular digits.
// The scanner, cart and API code are not part of the redesign, so the tests also check they are still wired the same way.
// Run with: npx tsx tests/pos-ui.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

(async () => {
  await test("theme: a grey canvas behind white panels, charcoal text, and tabular digits", () => {
    const css = read("app/globals.css");
    assert.ok(css.includes("--canvas:") && css.includes("--color-canvas: var(--canvas)"));
    assert.ok(css.includes("--card: oklch(1 0 0)"), "panels stay white");
    assert.ok(!css.includes("--foreground: oklch(0.145 0 0)\n    --card:"), "text is no longer pure black");
    assert.match(css, /\.num \{\s*font-variant-numeric: tabular-nums/);
    assert.ok(css.includes('html[lang="th"] body') && css.includes("line-height: 1.65"), "Thai text gets more line height");
    assert.ok(read("app/layout.tsx").includes("bg-canvas"));
  });

  await test("categories: one scrollable row, never wrapped onto several lines", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("overflow-x-auto") && panel.includes("scrollbar-none") && panel.includes("flex snap-x"));
    assert.ok(!/role="group"[\s\S]{0,400}flex-wrap/.test(panel), "the strip does not wrap");
    assert.ok(panel.includes("scrollBy") && panel.includes("onWheel"), "it can be moved with a button and the wheel");
    assert.ok(panel.includes("aria-pressed"), "the active category is exposed to assistive technology");
  });

  await test("grid: cards fill the width from about 9 rem, so a desktop shows five or more per row", () => {
    assert.ok(read("components/pos/product-panel.tsx").includes("grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"));
    assert.ok(read("components/pos/skeletons.tsx").includes("grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"), "the loading skeleton matches");
    assert.ok(read("app/pos/page.tsx").includes("grid-cols-[minmax(0,1fr)]"), "a narrow screen cannot be pushed wider by the grid");
  });

  await test("card: the photo is shown whole on a mat, never stretched, with size, colour, price and stock in order", () => {
    const card = read("components/pos/product-card.tsx");
    assert.ok(card.includes('fit="contain"') && card.includes("aspect-square"));
    const order = ["{name}", "{size}", "{color}", "formatBaht(price)", "{stockLabel}", "{sku}"].map((s) => card.indexOf(s));
    assert.ok(order.every((n) => n > 0) && order.every((n, i) => i === 0 || n > order[i - 1]), "reading order");
    assert.ok(read("components/pos/product-thumb.tsx").includes("object-contain"));
  });

  await test("sold out: the card is muted and tagged, the whole button is not faded, and it still cannot be pressed", () => {
    const tile = read("components/pos/product-tile.tsx");
    assert.ok(tile.includes("disabled={outOfStock}") && !tile.includes("opacity-50"));
    const card = read("components/pos/product-card.tsx");
    assert.ok(card.includes("grayscale") && card.includes('t("pos.soldOut")') && card.includes("text-muted-foreground"));
    assert.ok(!card.includes("line-through"), "nothing is struck out");
  });

  await test("cart: the total is the largest figure, a discount line shows, and the pay button is tall and solid", () => {
    const cart = read("components/pos/cart-panel.tsx");
    assert.ok(cart.includes("text-[2rem]") && cart.includes("h-14") && cart.includes('t("pos.youSave"'));
    assert.ok(cart.includes("disabled={!canCheckout || !online}") && cart.includes("onClick={onCheckout}"), "paying is guarded as before");
    assert.ok(cart.includes("disabled:opacity-100"), "the disabled button is grey but not faded into the page");
  });

  await test("untouched: the barcode field, scanner hook, stock check and API calls are wired as before", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes('id={BARCODE_INPUT_ID}') && panel.includes("onKeyDown={handleKeyDown}") && panel.includes("onChange={handleChange}"));
    assert.ok(panel.includes("useScannerInput(") && panel.includes("/api/products?") && panel.includes("/api/categories"));
    const page = read("app/pos/page.tsx");
    assert.ok(page.includes("addItemByBarcode(") && page.includes("/api/products/search?barcode="));
    assert.ok(read("components/pos/cart-line.tsx").includes("atStockLimit"), "the stock limit still disables +");
  });

  await test("messages: the new labels exist in both languages", () => {
    const messages = read("lib/i18n/messages.ts");
    for (const key of ["pos.youSave", "pos.categoriesNext"]) assert.equal((messages.match(new RegExp(`"${key}":`, "g")) ?? []).length, 2, key);
  });

  console.log(`\n${passed} pos-ui groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
