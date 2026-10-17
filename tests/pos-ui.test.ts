// The cashier screen and back office shell, checked in the source: the Lifework look (stark monochrome, sharp corners,
// tabular numbers, the Radog placeholder), one card per style with a colour and size picker, a fixed two-column laptop
// layout, the scanner fast path, quick-cash checkout, and a back office sidebar without duplicate entries.
// The scanner, cart, API and price code are not part of the redesign, so the tests also check they are wired the same way.
// Run with: npx tsx tests/pos-ui.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MESSAGES, LOCALES } from "../lib/i18n/messages";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

(async () => {
  await test("theme: black ink, white panels, a neutral canvas, and nothing rounder than 4px", () => {
    const css = read("app/globals.css");
    assert.ok(css.includes("--canvas:") && css.includes("--color-canvas: var(--canvas)"));
    assert.ok(css.includes("--card: oklch(1 0 0)"), "panels are pure white");
    assert.ok(css.includes("--primary: oklch(0.141 0.005 286)"), "buttons and ink are near-black (#09090B)");
    for (const size of ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) {
      const px = Number(new RegExp(`--radius-${size}: (\\d+)px`).exec(css)?.[1]);
      assert.ok(px >= 2 && px <= 4, `--radius-${size} is ${px}px`);
    }
    assert.ok(read("app/layout.tsx").includes("bg-canvas"));
  });

  await test("typography: capital extra-bold headings, Thai line height, and tabular monospaced digits for money", () => {
    const css = read("app/globals.css");
    assert.match(css, /h1,\s*h2,\s*h3 \{[^}]*font-weight: 800[^}]*text-transform: uppercase/);
    assert.ok(css.includes('html[lang="th"] body') && css.includes("line-height: 1.65"));
    assert.match(css, /\.num \{[^}]*font-family: var\(--font-geist-mono\)[^}]*font-variant-numeric: tabular-nums/);
    for (const file of ["components/pos/style-card.tsx", "components/pos/cart-panel.tsx", "components/pos/variant-picker.tsx"]) {
      assert.ok(read(file).includes("num "), `${file} uses .num for its figures`);
    }
  });

  await test("brand files: the logo and Radog pictures exist as transparent PNGs, and every path the code uses points at one", async () => {
    const sharp = (await import("sharp")).default;
    for (const file of ["radog.png", "main-logo.png", "main-logo-white.png"]) {
      const full = path.join(__dirname, "..", "public", "brand", file);
      assert.ok(existsSync(full), `${file} exists`);
      const meta = await sharp(full).metadata();
      assert.equal(meta.format, "png");
      assert.equal(meta.hasAlpha, true, `${file} is transparent`);
      assert.ok((meta.width ?? 0) >= 250, `${file} is at least 250px wide`);
    }
    const used = ["app/pos/page.tsx", "app/admin/layout.tsx", "components/brand/radog-mark.tsx"].flatMap((file) =>
      Array.from(read(file).matchAll(/"(\/brand\/[a-z-]+\.[a-z]+)"/g)).map((m) => m[1]),
    );
    assert.ok(used.length >= 3, "the pages reference the brand files");
    for (const url of used) assert.ok(existsSync(path.join(__dirname, "..", "public", url)), `${url} exists`);
  });

  await test("brand: the logo picture in the till header (with the old text kept for screen readers), and the Radog placeholder instead of a T-shirt", () => {
    const page = read("app/pos/page.tsx");
    assert.ok(page.includes('src="/brand/main-logo.png"') && page.includes("LIFEWORK // TERMINAL") && page.includes("sr-only") && page.includes("h-9"));
    assert.ok(read("app/admin/layout.tsx").includes('src="/brand/main-logo-white.png"'), "the black sidebar uses the white logo");
    const thumb = read("components/pos/product-thumb.tsx");
    assert.ok(thumb.includes("RadogMark") && !thumb.includes("Shirt"));
    const mark = read("components/brand/radog-mark.tsx");
    assert.ok(mark.includes("/brand/radog.png") && mark.includes("onError") && mark.includes("RadogSilhouette"), "artwork when present, silhouette otherwise");
    assert.ok(existsSync(path.join(__dirname, "..", "public", "brand", "README.md")));
  });

  await test("categories: one scrollable row, never wrapped onto several lines", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("overflow-x-auto") && panel.includes("scrollbar-none") && panel.includes("flex snap-x"));
    assert.ok(!/role="group"[\s\S]{0,400}flex-wrap/.test(panel), "the strip does not wrap");
    assert.ok(panel.includes("scrollBy") && panel.includes("onWheel") && panel.includes("aria-pressed"));
  });

  await test("layout: fixed two columns for a laptop (catalogue left, 380px cart right), the page itself never scrolls", () => {
    const page = read("app/pos/page.tsx");
    assert.ok(page.includes("grid-cols-[minmax(0,1fr)_380px]") && page.includes("h-dvh") && page.includes("overflow-hidden"));
    assert.ok(!page.includes("lg:grid-cols") && !page.includes("xl:grid-cols") && !page.includes("min-h-dvh"));
  });

  await test("grid: five cards per row on a 1366 laptop and six on a wide one", () => {
    for (const file of ["components/pos/product-panel.tsx", "components/pos/skeletons.tsx"]) {
      const code = read(file);
      assert.ok(code.includes("grid-cols-4") && code.includes("min-[1280px]:grid-cols-5") && code.includes("min-[1600px]:grid-cols-6"), file);
    }
  });

  await test("grouping: one card per style from the styles endpoint, a picker for the mouse, and no per-variant tile any more", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("/api/products/styles?") && panel.includes("<StyleCard") && panel.includes("<VariantPicker"));
    assert.ok(!panel.includes("ProductTile") && !existsSync(path.join(__dirname, "..", "components", "pos", "product-tile.tsx")));
    const route = read("app/api/products/styles/route.ts");
    assert.ok(route.includes("export async function GET") && !route.includes("export async function POST"), "read only");
    assert.ok(route.includes("variantImageUrl") && route.includes("formatMoney"), "prices and photos come from the same helpers as before");
  });

  await test("barcode fast path: a scan adds the exact variant at once and never opens the picker; the scanner pauses while the picker is open", () => {
    const page = read("app/pos/page.tsx");
    assert.ok(page.includes("/api/products/search?barcode=") && page.includes("addItemByBarcode("));
    assert.ok(!page.includes("VariantPicker"), "the scan path does not touch the picker");
    assert.ok(read("components/pos/product-panel.tsx").includes("enabled: scannerActive && !picked"));
  });

  await test("picker: colour, then size, then add; Enter adds; sizes out of stock stay visible but cannot be chosen", () => {
    const picker = read("components/pos/variant-picker.tsx");
    assert.ok(picker.includes('t("pos.pickColor")') && picker.includes('t("pos.pickSize")') && picker.includes('t("pos.addToCart")'));
    assert.ok(picker.includes('event.key === "Enter"') && picker.includes("disabled={out}") && picker.includes("disabled={!canAdd}"));
    assert.ok(picker.includes("toVariantSummary(") && picker.includes("defaultSelection("));
  });

  await test("card: style code, photo, price and an options badge; OUT OF STOCK is a small tag and nothing is greyed", () => {
    const card = read("components/pos/style-card.tsx");
    assert.ok(card.includes("styleBadge(") && card.includes("priceRange(") && card.includes('fit="contain"') && card.includes("aspect-[5/4]"));
    const order = ["{name}", "styleBadge(", "formatBaht(min)", 't("pos.left"'].map((s) => card.indexOf(s));
    assert.ok(order.every((n) => n > 0) && order.every((n, i) => i === 0 || n > order[i - 1]), "reading order");
    assert.ok(card.includes("pos.outOfStockBadge") && !card.includes("grayscale") && !card.includes("opacity-") && !card.includes("line-through"));
    for (const locale of LOCALES) assert.equal(MESSAGES[locale]["pos.outOfStockBadge"], "OUT OF STOCK");
  });

  await test("cart: the total is the largest figure, a discount line shows, and the pay button is tall, black and solid", () => {
    const cart = read("components/pos/cart-panel.tsx");
    assert.ok(cart.includes("text-[2rem]") && cart.includes("h-14") && cart.includes("bg-black") && cart.includes('t("pos.youSave"'));
    assert.ok(cart.includes("disabled={!canCheckout || !online}") && cart.includes("onClick={onCheckout}"));
    assert.ok(cart.includes("disabled:opacity-100"));
  });

  await test("scanner flow: the cursor starts in the barcode field and returns to it after a click or a discount", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("autoFocus") && panel.includes("focusBarcodeField"));
    assert.ok(panel.includes("window.setTimeout(focusBarcodeField") && panel.includes("function selectCategory"), "after the picker closes and after a category click");
    const cart = read("components/pos/cart-panel.tsx");
    assert.ok(cart.includes("onClickCapture={focusBarcodeField}") && cart.includes('event.key === "Enter") focusBarcodeField()'));
    assert.ok(read("lib/pos-focus.ts").includes("pos-barcode-input"));
  });

  await test("checkout: four quick-cash buttons in fixed places, change shown large at once, Enter completes the sale", () => {
    const dialog = read("components/pos/checkout-dialog.tsx");
    assert.ok(dialog.includes("grid-cols-4") && dialog.includes("[amountSatang, ...BILL_DENOMINATIONS.map((b) => b * 100)]"));
    assert.ok(dialog.includes("value < amountSatang") && dialog.includes("BILL_DENOMINATIONS = [100, 500, 1000]"));
    assert.ok(dialog.includes("autoFocus") && dialog.includes('event.key === "Enter"') && dialog.includes("if (canSubmit) void submit()"));
    assert.ok(dialog.includes("text-2xl leading-none font-bold") && dialog.includes("text-3xl"));
  });

  await test("back office: a black left sidebar with every entry once, groups that do not repeat an entry's name, full-width pages", () => {
    const layout = read("app/admin/layout.tsx");
    assert.ok(layout.includes("<aside") && layout.includes("bg-zinc-950") && layout.includes("<AdminNav") && !layout.includes("max-w-7xl") && !layout.includes("<header"));
    const hrefs = Array.from(layout.matchAll(/href: "(\/admin[^"]*)"/g)).map((m) => m[1]);
    assert.equal(hrefs.length, 14);
    assert.equal(new Set(hrefs).size, 14, "no page is listed twice");
    const keys = Array.from(layout.matchAll(/key: "(nav\.[A-Za-z]+)"/g)).map((m) => m[1]);
    const groups = Array.from(layout.matchAll(/title: "(nav\.group[A-Za-z]+)"/g)).map((m) => m[1]);
    for (const locale of LOCALES) {
      const labels = keys.map((key) => MESSAGES[locale][key as keyof (typeof MESSAGES)["th"]]);
      for (const group of groups) {
        const title = MESSAGES[locale][group as keyof (typeof MESSAGES)["th"]];
        assert.ok(!labels.includes(title), `${locale}: the group "${title}" repeats an entry`);
      }
      assert.equal(new Set(labels).size, labels.length, `${locale}: two entries share a label`);
    }
  });

  await test("untouched: the barcode field, scanner hook, stock check and API calls are wired as before", () => {
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("id={BARCODE_INPUT_ID}") && panel.includes("onKeyDown={handleKeyDown}") && panel.includes("onChange={handleChange}"));
    assert.ok(panel.includes("useScannerInput(") && panel.includes("/api/categories"));
    assert.ok(read("components/pos/cart-line.tsx").includes("atStockLimit"));
    assert.ok(read("components/pos/checkout-dialog.tsx").includes('"/api/orders/checkout"'));
    for (const file of ["app/api/products/route.ts", "app/api/products/search/route.ts"]) assert.ok(existsSync(path.join(__dirname, "..", file)), `${file} still exists`);
  });

  await test("messages: the new labels exist in both languages", () => {
    for (const key of ["pos.youSave", "pos.categoriesNext", "pos.pickColor", "pos.pickSize", "pos.addToCart", "pos.pickOptions", "nav.groupSales", "nav.groupProducts", "nav.groupStock"] as const) {
      for (const locale of LOCALES) assert.ok(MESSAGES[locale][key], `${locale} ${key}`);
    }
  });

  console.log(`\n${passed} pos-ui groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
