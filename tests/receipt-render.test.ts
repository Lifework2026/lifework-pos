// Renders the real receipt component and checks the totals block: items, sub total, VAT, grand total, "*Vat Included*".
// The language hook is replaced by the real translator, so the receipt renders outside Next.
// Run with: npx tsx tests/receipt-render.test.ts
import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translate, type Locale, type MessageKey } from "../lib/i18n/messages";
import type { OrderDetails } from "../lib/pos-types";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

// The test runner compiles JSX the classic way, which looks for a global React. Next supplies it when it builds.
Object.assign(globalThis, { React });

let locale: Locale = "en";
const clientPath = require.resolve("../lib/i18n/client");
require.cache[clientPath] = {
  id: clientPath,
  filename: clientPath,
  loaded: true,
  exports: {
    useI18n: () => ({
      locale,
      t: (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
      setLocale: () => undefined,
    }),
  },
} as unknown as NodeModule;
const { Receipt } = require("../components/pos/receipt") as typeof import("../components/pos/receipt");

function order(overrides: Partial<OrderDetails>): OrderDetails {
  return {
    id: "o1",
    receiptNo: "LW-202610-00001",
    status: "COMPLETED",
    createdAt: "2026-10-17T04:00:00.000Z",
    store: { name: "Lifework", branch: "Mega Bangna", code: "LW01" },
    cashier: { id: "u1", fullName: "Lifework Admin" },
    member: null,
    promotionName: null,
    bagType: "NONE",
    subtotal: "1290.00",
    promotionDiscount: "0.00",
    memberDiscount: "0.00",
    manualDiscount: "0.00",
    pointsDiscount: "0.00",
    totalAmount: "1290.00",
    netAmount: "1205.61",
    vatAmount: "84.39",
    vatPercent: 7,
    refundedAmount: "0.00",
    voidReason: null,
    voidedAt: null,
    taxInvoice: null,
    payments: [
      { id: "p1", method: "CASH", amount: "1290.00", refundedAmount: "0.00", tendered: "1500.00", changeGiven: "210.00", reference: null, edcRef: null },
    ],
    items: [
      {
        id: "i1",
        variantId: "v1",
        productName: "LW252AN172",
        productNameTh: null,
        sku: "LW252AN17263L",
        barcode: "LW252AN17263L",
        size: "L",
        color: "LIGHT BLUE",
        isBag: false,
        quantity: 1,
        refundedQuantity: 0,
        unitPrice: "1290.00",
        lineSubtotal: "1290.00",
        discountAmount: "0.00",
        netAmount: "1290.00",
        refundedAmount: "0.00",
      },
    ],
    ...overrides,
  };
}

/** The receipt as plain lines of text, in order. */
function lines(value: OrderDetails): string[] {
  const html = renderToStaticMarkup(createElement(Receipt, { order: value }));
  return html
    .replace(/<\/(div|p)>/g, "\n")
    .replace(/<\/span><span[^>]*>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const indexOfLine = (all: string[], start: string): number => all.findIndex((line) => line.startsWith(start));

(async () => {
  await test("no discount: the totals read sub total, VAT 7%, grand total, then *Vat Included*, with the stored figures", () => {
    locale = "en";
    const all = lines(order({}));
    const sub = indexOfLine(all, "Sub total");
    const vat = indexOfLine(all, "VAT (7%)");
    const grand = indexOfLine(all, "GRAND TOTAL");
    const included = indexOfLine(all, "*Vat Included*");
    assert.ok(sub > 0 && vat > sub && grand > vat && included > grand, JSON.stringify(all));
    assert.match(all[sub], /฿1,205\.61/);
    assert.match(all[vat], /฿84\.39/);
    assert.match(all[grand], /฿1,290\.00/);
    assert.equal(indexOfLine(all, "Items total"), -1, "no items-total line when there is no discount");
  });

  await test("the receipt shows the stored split, not a new calculation", () => {
    locale = "en";
    // Figures that differ from what 7/107 would give prove the receipt prints what is stored.
    const all = lines(order({ netAmount: "1000.00", vatAmount: "290.00" }));
    assert.match(all[indexOfLine(all, "Sub total")], /฿1,000\.00/);
    assert.match(all[indexOfLine(all, "VAT (7%)")], /฿290\.00/);
  });

  await test("with a discount: items total and the discount come first, then the same VAT block on the payable amount", () => {
    locale = "en";
    const all = lines(
      order({ memberDiscount: "100.00", totalAmount: "1190.00", netAmount: "1112.14", vatAmount: "77.86", member: { name: "Somchai", phone: "0812345678", pointsEarned: 0, pointsRedeemed: 0 } }),
    );
    const items = indexOfLine(all, "Items total");
    const discount = indexOfLine(all, "Member discount");
    const sub = indexOfLine(all, "Sub total");
    const vat = indexOfLine(all, "VAT (7%)");
    const grand = indexOfLine(all, "GRAND TOTAL");
    assert.ok(items > 0 && discount > items && sub > discount && vat > sub && grand > vat, JSON.stringify(all));
    assert.match(all[items], /฿1,290\.00/);
    assert.match(all[sub], /฿1,112\.14/);
    assert.match(all[vat], /฿77\.86/);
    assert.match(all[grand], /฿1,190\.00/);
  });

  await test("thai receipt: the same block in Thai", () => {
    locale = "th";
    const all = lines(order({}));
    const sub = indexOfLine(all, "ยอดก่อนภาษี");
    const vat = indexOfLine(all, "ภาษีมูลค่าเพิ่ม (7%)");
    const grand = indexOfLine(all, "รวมทั้งสิ้น");
    const included = indexOfLine(all, "*รวมภาษีมูลค่าเพิ่มแล้ว*");
    assert.ok(sub > 0 && vat > sub && grand > vat && included > grand, JSON.stringify(all));
  });

  console.log(`\n${passed} receipt-render groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
