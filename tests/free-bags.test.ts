// The free shopping bags (Paper and Rpet, S/M/L, 0 baht) and the 80mm receipt print rules.
// Run with: npx tsx tests/free-bags.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { allFreeBags, FREE_BAG_CART_STOCK, FREE_BAG_PRODUCT_SLUGS, freeBagSku, isFreeBag } from "../lib/catalog/free-bags";
import { calculatePricing } from "../lib/pricing";
import { splitInclusiveVat } from "../lib/tax-rules";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("bags: two kinds in three sizes make six SKUs, each recognised as a free bag", () => {
  const all = allFreeBags();
  assert.equal(all.length, 6);
  assert.deepEqual(all.map((b) => b.sku), ["BAG-PAPER-S", "BAG-PAPER-M", "BAG-PAPER-L", "BAG-RPET-S", "BAG-RPET-M", "BAG-RPET-L"]);
  for (const bag of all) assert.ok(isFreeBag(bag.sku));
  assert.equal(freeBagSku("RPET", "M"), "BAG-RPET-M");
});

test("bags: the old paid bags and ordinary SKUs are not free bags", () => {
  for (const sku of ["BAG-SMALL", "BAG-LARGE", "LW265TS99035XL", "BAG-PAPER-XL", "BAG-PAPER-", "bag-paper-s", "XBAG-RPET-S"]) assert.equal(isFreeBag(sku), false, sku);
});

test("bags: the two products are hidden from the sales grid by slug", () => {
  assert.deepEqual(FREE_BAG_PRODUCT_SLUGS, ["paper-bag", "rpet-bag"]);
  assert.ok(read("app/api/products/styles/route.ts").includes("slug: { notIn: FREE_BAG_PRODUCT_SLUGS }"));
});

test("pricing: a free bag adds nothing to the total, the VAT, or the merchandise discount base", () => {
  const withBag = calculatePricing({
    lines: [
      { key: "shirt", unitPriceSatang: 129_000, quantity: 1, isBag: false, promoEligible: false },
      { key: "bag", unitPriceSatang: 0, quantity: 3, isBag: false, promoEligible: false },
    ],
    promotion: null,
    memberDiscountScaled: 0,
    manualDiscountSatang: 10_000,
    pointsToRedeem: 0,
    pointsBalance: 0,
    pointValueSatang: 100,
    earnThresholdSatang: 10_000,
    isMember: false,
  });
  const without = calculatePricing({
    lines: [{ key: "shirt", unitPriceSatang: 129_000, quantity: 1, isBag: false, promoEligible: false }],
    promotion: null,
    memberDiscountScaled: 0,
    manualDiscountSatang: 10_000,
    pointsToRedeem: 0,
    pointsBalance: 0,
    pointValueSatang: 100,
    earnThresholdSatang: 10_000,
    isMember: false,
  });
  assert.equal(withBag.total, without.total);
  assert.equal(withBag.subtotal, without.subtotal);
  assert.deepEqual(splitInclusiveVat(withBag.total), splitInclusiveVat(without.total));
  const bagLine = withBag.lines.find((line) => line.key === "bag");
  assert.equal(bagLine?.subtotal, 0);
  assert.equal(bagLine?.net, 0);
});

test("server: a free bag is never refused for stock, takes nothing off the stock, and leaves no ledger line", () => {
  const context = read("lib/orders/context.ts");
  assert.ok(context.includes("variant.stockQuantity < requested.quantity && !isFreeBag(variant.sku)"));
  const checkout = read("app/api/orders/checkout/route.ts");
  assert.ok(checkout.includes("if (isFreeBag(line.sku)) continue;"), "no stock decrement");
  assert.ok(checkout.includes("basket.lines.filter((line) => !isFreeBag(line.sku))"), "no stock ledger line");
  const resume = read("app/api/held-bills/[id]/resume/route.ts");
  assert.ok(resume.includes("const counted = !isFreeBag(variant.sku)") && resume.includes("FREE_BAG_CART_STOCK"), "a held bill keeps its bags");
});

test("server: the VAT split and the other stock rules were not touched", () => {
  const checkout = read("app/api/orders/checkout/route.ts");
  assert.ok(checkout.includes("splitInclusiveVat(pricing.total)"));
  assert.ok(checkout.includes("stockQuantity: { gte: line.quantity }"), "other items still cannot oversell");
  assert.ok(read("lib/orders/context.ts").includes('"INSUFFICIENT_STOCK"'));
});

test("till: a free bag is never limited by stock in the cart, and shows as 'name (size)' at 0 baht", () => {
  assert.equal(FREE_BAG_CART_STOCK, 9999);
  const page = read("app/pos/page.tsx");
  assert.ok(page.includes("isFreeBag(variant.sku) ? FREE_BAG_CART_STOCK : variant.stockQuantity"));
  const line = read("components/pos/cart-line.tsx");
  assert.ok(line.includes("(bag ? ` (${item.size})` : \"\")"));
  const receipt = read("components/pos/receipt.tsx");
  assert.ok(receipt.includes("isFreeBag(item.sku) ? ` (${item.size})`") && receipt.includes("item.isBag || isFreeBag(item.sku) ? item.sku"));
});

test("bag selector: above the cart lines, Paper and Rpet each in S, M, L, adding through the normal barcode lookup", () => {
  const quick = read("components/pos/quick-bag.tsx");
  assert.ok(quick.includes("FREE_BAG_TYPES.map") && quick.includes("FREE_BAG_SIZES.map") && quick.includes("freeBagSku(bag.key, size)"));
  assert.ok(quick.includes("focusBarcodeField"), "the cursor goes back to the barcode field");
  const cart = read("components/pos/cart-panel.tsx");
  assert.ok(cart.indexOf("<QuickBag") > 0 && cart.indexOf("<QuickBag") < cart.indexOf("<CartLine"), "above the lines");
  assert.ok(read("app/pos/page.tsx").includes("lookupAndAdd({ barcode: sku, converted: false, fast: true })"));
});

test("seed: the script makes the two products and six variants at 0.00, safe to run again", () => {
  const script = read("scripts/seed-free-bags.ts");
  assert.ok(script.includes('price: "0.00"') && script.includes("FREE_BAG_TYPES") && script.includes("exists") && script.includes("--apply"));
  assert.ok(existsSync(path.join(__dirname, "..", "scripts", "seed-free-bags.ts")));
});

test("print: 80mm wide content with no page margin, a receipt that is never split, and a readable font size", () => {
  const css = read("app/globals.css");
  const print = css.slice(css.indexOf("@media print {"));
  assert.match(print, /@page \{\s*margin: 0;\s*\}/);
  assert.ok(!css.includes("size: 80mm auto"), "'80mm auto' is not valid CSS, so it stays out (the driver sets the paper length)");
  assert.match(print, /html,\s*body \{[^}]*width: 80mm !important;[^}]*max-width: 80mm !important/);
  assert.match(print, /#print-root \{[^}]*width: 80mm;[^}]*max-width: 80mm;/);
  assert.match(print, /#print-root \.receipt-print \{[^}]*font-size: 12px;[^}]*line-height: 1\.4;[^}]*break-inside: avoid;[^}]*page-break-inside: avoid;/);
  assert.match(print, /\.receipt-row > span:last-child \{[^}]*white-space: nowrap/);
  assert.ok(print.includes("body > *:not(#print-root)") && print.includes("display: none !important"), "the web page is removed from the printout");
  assert.ok(print.includes("@page a4-document") && print.includes("max-width: none"), "the A4 tax invoice still prints on A4");
});

console.log(`\n${passed} free-bag groups passed`);
