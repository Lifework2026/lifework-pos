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

  await test("layout: fixed two columns for a laptop (catalogue left, 380px cart right), the page itself never scrolls", () => {
    const page = read("app/pos/page.tsx");
    assert.ok(page.includes("grid-cols-[minmax(0,1fr)_380px]") && page.includes("h-dvh") && page.includes("overflow-hidden"));
    assert.ok(!page.includes("lg:grid-cols") && !page.includes("xl:grid-cols"), "no stacking for narrow screens");
    assert.ok(!page.includes("min-h-dvh"), "the till is exactly one screen high");
  });

  await test("grid: five cards per row on a 1366 laptop and six on a wide one", () => {
    for (const file of ["components/pos/product-panel.tsx", "components/pos/skeletons.tsx"]) {
      assert.ok(read(file).includes("grid-cols-4") && read(file).includes("min-[1280px]:grid-cols-5") && read(file).includes("min-[1600px]:grid-cols-6"), file);
    }
  });

  await test("card: the photo is shown whole on a mat, never stretched, with size, colour, price and stock in order", () => {
    const card = read("components/pos/product-card.tsx");
    assert.ok(card.includes('fit="contain"') && card.includes("aspect-[5/4]"));
    const order = ["{name}", "{size}", "{color}", "formatBaht(price)", "{stockLabel}", "{sku}"].map((s) => card.indexOf(s));
    assert.ok(order.every((n) => n > 0) && order.every((n, i) => i === 0 || n > order[i - 1]), "reading order");
    assert.ok(read("components/pos/product-thumb.tsx").includes("object-contain"));
  });

  await test("sold out: the photo, colours and price keep full strength; only a small badge and the stock figure change", () => {
    const tile = read("components/pos/product-tile.tsx");
    assert.ok(tile.includes("disabled={outOfStock}") && !tile.includes("opacity-50"), "still cannot be pressed");
    const card = read("components/pos/product-card.tsx");
    assert.ok(!card.includes("grayscale") && !card.includes("opacity-60") && !card.includes("line-through"), "nothing is greyed or struck out");
    assert.ok(card.includes('t("pos.soldOut")') && card.includes("text-destructive"));
  });

  await test("cart: the total is the largest figure, a discount line shows, and the pay button is tall and solid", () => {
    const cart = read("components/pos/cart-panel.tsx");
    assert.ok(cart.includes("text-[2rem]") && cart.includes("h-14") && cart.includes('t("pos.youSave"'));
    assert.ok(cart.includes("disabled={!canCheckout || !online}") && cart.includes("onClick={onCheckout}"), "paying is guarded as before");
    assert.ok(cart.includes("disabled:opacity-100"), "the disabled button is grey but not faded into the page");
  });

  await test("scanner flow: the cursor starts in the barcode field and returns to it after a click or a discount", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("autoFocus") && panel.includes("focusBarcodeField()"));
    assert.equal((panel.match(/focusBarcodeField\(\)/g) ?? []).length, 2, "after a product click and after a category click");
    const cart = read("components/pos/cart-panel.tsx");
    assert.ok(cart.includes("onClickCapture={focusBarcodeField}") && cart.includes('event.key === "Enter") focusBarcodeField()'));
    assert.ok(read("lib/pos-focus.ts").includes("pos-barcode-input"));
  });

  await test("checkout: four quick-cash buttons in fixed places, change shown large at once, Enter completes the sale", () => {
    const dialog = read("components/pos/checkout-dialog.tsx");
    assert.ok(dialog.includes("grid-cols-4") && dialog.includes("[amountSatang, ...BILL_DENOMINATIONS.map((b) => b * 100)]"));
    assert.ok(dialog.includes("value < amountSatang"), "a note smaller than the amount is greyed out, not hidden");
    assert.ok(dialog.includes("BILL_DENOMINATIONS = [100, 500, 1000]"));
    assert.ok(dialog.includes("autoFocus") && dialog.includes('event.key === "Enter"') && dialog.includes("onSubmit()"));
    assert.ok(dialog.includes("if (canSubmit) void submit()"), "Enter never skips the checks");
    assert.ok(dialog.includes("text-2xl leading-none font-bold") && dialog.includes("text-3xl"), "change and total are large");
  });

  await test("back office: the menu is a left sidebar, the page gets the full width, and wide tables are not boxed in", () => {
    const layout = read("app/admin/layout.tsx");
    assert.ok(layout.includes("<aside") && layout.includes("<AdminNav") && layout.includes("w-56"));
    assert.ok(!layout.includes("max-w-7xl") && !layout.includes("<header"), "no top bar and no width cap");
    const hrefs = Array.from(layout.matchAll(/href: "(\/admin[^"]*)"/g)).map((m) => m[1]);
    assert.equal(hrefs.length, 14, "every menu entry is still there");
    assert.ok(read("components/admin/admin-nav.tsx").includes("aria-current"));
  });

  await test("untouched: the barcode field, scanner hook, stock check and API calls are wired as before", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("id={BARCODE_INPUT_ID}") && panel.includes("onKeyDown={handleKeyDown}") && panel.includes("onChange={handleChange}"));
    assert.ok(panel.includes("useScannerInput(") && panel.includes("/api/products?") && panel.includes("/api/categories"));
    const page = read("app/pos/page.tsx");
    assert.ok(page.includes("addItemByBarcode(") && page.includes("/api/products/search?barcode="));
    assert.ok(read("components/pos/cart-line.tsx").includes("atStockLimit"), "the stock limit still disables +");
    assert.ok(read("components/pos/checkout-dialog.tsx").includes('"/api/orders/checkout"'));
  });

  await test("messages: the new labels exist in both languages", () => {
    const messages = read("lib/i18n/messages.ts");
    for (const key of ["pos.youSave", "pos.categoriesNext", "nav.groupSales", "nav.groupProducts", "nav.groupStock"]) assert.equal((messages.match(new RegExp(`"${key}":`, "g")) ?? []).length, 2, key);
  });

  console.log(`\n${passed} pos-ui groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
