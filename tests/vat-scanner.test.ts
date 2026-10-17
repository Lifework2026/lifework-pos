// Stored VAT split and the POS barcode field: the arithmetic, the Thai keyboard recovery, and the structure that keeps
// scanning inside one field. Run with: npx tsx tests/vat-scanner.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { containsThai, thaiToEnglish } from "../lib/keyboard/thai-keymap";
import { resolveScan, SCAN_WINDOW_MS } from "../lib/scanner-input";
import { splitInclusiveVat, vatFromInclusiveSatang } from "../lib/tax-rules";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

(async () => {
  await test("vat: 1,290.00 baht splits into 1,205.61 before VAT and 84.39 VAT", () => {
    assert.deepEqual(splitInclusiveVat(129000), { netSatang: 120561, vatSatang: 8439 });
  });

  await test("vat: 107.00 baht is exactly 100.00 plus 7.00", () => {
    assert.deepEqual(splitInclusiveVat(10700), { netSatang: 10000, vatSatang: 700 });
  });

  await test("vat: the two parts always add up to the total, for every amount up to 200 baht", () => {
    for (let total = 0; total <= 20000; total += 1) {
      const { netSatang, vatSatang } = splitInclusiveVat(total);
      assert.equal(netSatang + vatSatang, total, `total ${total}`);
      assert.ok(netSatang >= 0 && vatSatang >= 0, `non-negative for ${total}`);
    }
  });

  await test("vat: the VAT is the nearest satang to total x 7 / 107, which is total minus total / 1.07", () => {
    for (let total = 1; total <= 200000; total += 37) {
      const exact = (total * 7) / 107;
      const { vatSatang } = splitInclusiveVat(total);
      assert.ok(Math.abs(vatSatang - exact) <= 0.5, `total ${total}`);
      assert.ok(Math.abs(total - total / 1.07 - exact) < 1e-6, `1.07 form for ${total}`);
      assert.equal(vatSatang, vatFromInclusiveSatang(total));
    }
  });

  await test("thai keymap: a code typed on the Thai layout comes back as the keys that were pressed", () => {
    // L W 2 5 2 A N 1 7 2 6 3 L on Kedmanee: shifted L = ศ, shifted W = ", the 2 key = /, the 5 key = ถ, shifted A = ฤ,
    // shifted N = ์, the 1 key = ๅ, the 7 key = ึ, the 6 key = ุ, the 3 key = -.
    assert.equal(thaiToEnglish('ศ"/ถ/ฤ์ๅึ/ุ-ศ'), "LW252AN17263L");
  });

  await test("thai keymap: the digit row and the letter rows map back, lower and upper case", () => {
    assert.equal(thaiToEnglish("ๅ/-ภถุึคตจ"), "1234567890");
    assert.equal(thaiToEnglish("ๆไำพะัีรนย"), "qwertyuiop");
    assert.equal(thaiToEnglish("ฟหกดเ้่าส"), "asdfghjkl");
    assert.equal(thaiToEnglish("ผปแอิืท"), "zxcvbnm");
    assert.equal(thaiToEnglish('๐"ฎฑธํ๊ณฯญ'), "QWERTYUIOP");
    assert.equal(thaiToEnglish("ฤฆฏโฌ็๋ษศ"), "ASDFGHJKL");
    assert.equal(thaiToEnglish("()ฉฮฺ์?"), "ZXCVBNM");
  });

  await test("thai keymap: the barcode punctuation keys map back (hyphen, dot, slash, underscore)", () => {
    assert.equal(thaiToEnglish("AขBใCฝD๘E"), "A-B.C/D_E");
  });

  await test("thai keymap: text with no Thai character is returned untouched, so a real hyphen or slash is safe", () => {
    for (const text of ["LW252-AB/1", "LW252AN17263L", "shirt", "123", "a.b_c"]) {
      assert.equal(thaiToEnglish(text), text);
      assert.equal(containsThai(text), false);
    }
    assert.equal(containsThai("เสื้อ"), true);
  });

  await test("scan: a Thai layout scan that arrives in a burst is converted and counts as a scanner", () => {
    const decision = resolveScan('ศ"/ถ/ฤ์ๅึ/ุ-ศ', 90);
    assert.deepEqual(decision, { barcode: "LW252AN17263L", converted: true, fast: true });
  });

  await test("scan: an English scan needs no conversion, and typing slowly is not a scanner", () => {
    assert.deepEqual(resolveScan("LW252AN17263L", 120), { barcode: "LW252AN17263L", converted: false, fast: true });
    assert.equal(resolveScan("LW252AN17263L", SCAN_WINDOW_MS + 1)?.fast, false);
    assert.equal(resolveScan("LW252AN17263L", null)?.fast, false);
  });

  await test("scan: text that is not shaped like a barcode is left to the normal search", () => {
    assert.equal(resolveScan("", 50), null);
    assert.equal(resolveScan("   ", 50), null);
    assert.equal(resolveScan("ab", 50), null, "too short");
    assert.equal(resolveScan("white shirt", 50), null, "a space is not a barcode character");
    assert.equal(resolveScan("เสื้อ ยืด", 50), null);
  });

  await test("structure: the POS page has no page-wide scanner; the barcode field owns scanning", () => {
    const page = read("app/pos/page.tsx");
    assert.ok(!page.includes("useBarcodeScanner"), "the POS page must not listen on the window");
    const panel = read("components/pos/product-panel.tsx");
    assert.ok(panel.includes("useScannerInput"), "the barcode field uses useScannerInput");
    assert.ok(panel.includes("onKeyDown={handleKeyDown}"), "Enter is handled on the field itself");
    const hook = read("hooks/useScannerInput.ts");
    assert.ok(!/addEventListener\(\s*["']keydown["']/.test(hook), "no window keydown listener in the scanner hook");
    assert.ok(!/setTimeout\([^)]*debounce/i.test(hook), "no debounce in the scan path");
  });

  await test("structure: the stock receive page keeps its scanner and now recovers the Thai layout too", () => {
    assert.ok(read("hooks/useBarcodeScanner.ts").includes("thaiToEnglish(scanned)"));
  });

  await test("structure: checkout stores the split, and the receipt and tax invoice read the stored figures", () => {
    const checkout = read("app/api/orders/checkout/route.ts");
    assert.ok(checkout.includes("splitInclusiveVat(pricing.total)"));
    assert.ok(checkout.includes("netAmount: satangToDecimal(netSatang)") && checkout.includes("vatAmount: satangToDecimal(vatSatang)"));
    const serialize = read("lib/orders/serialize.ts");
    assert.ok(serialize.includes("formatMoney(order.netAmount)") && serialize.includes("formatMoney(order.vatAmount)"));
    assert.ok(!serialize.includes("vatFromInclusiveSatang"), "the serializer no longer recomputes VAT");
    const receipt = read("components/pos/receipt.tsx");
    assert.ok(receipt.includes("order.netAmount") && receipt.includes("order.vatAmount") && receipt.includes("receipt.vatIncluded"));
  });

  await test("structure: the migration backfills, makes both columns required, and adds the add-up check", () => {
    const sql = read("prisma/migrations/20261021000000_order_vat_split/migration.sql");
    assert.ok(sql.includes('ADD COLUMN     "netAmount" DECIMAL(12,2)'));
    assert.ok(sql.includes("SET NOT NULL"));
    assert.ok(sql.includes('CHECK ("netAmount" + "vatAmount" = "totalAmount"'));
    assert.ok(!/DROP|TRUNCATE|DELETE/i.test(sql), "the migration is additive");
  });

  console.log(`\n${passed} vat-and-scanner groups passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
