// Tax, VAT, tax invoice numbering, seller details and the end-of-day arithmetic.
// Run with: npx tsx tests/finance.test.ts
import assert from "node:assert/strict";
import { getSellerInfo } from "../lib/tax-seller";
import {
  branchLabel,
  formatTaxInvoiceNumber,
  isValidBranchNo,
  isValidThaiTaxId,
  vatFromInclusiveSatang,
} from "../lib/tax-rules";
import { buildEodReport, eodExport, type EodInputs, type EodShiftRow } from "../lib/eod";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

// ------------------------------------------------------------------ tax IDs
test("a 13-digit Thai tax ID is accepted only with a correct check digit", () => {
  assert.equal(isValidThaiTaxId("0107536000102"), true);
  assert.equal(isValidThaiTaxId("0107536000103"), false, "wrong check digit");
  assert.equal(isValidThaiTaxId("010753600010"), false, "12 digits");
  assert.equal(isValidThaiTaxId("01075360001020"), false, "14 digits");
  assert.equal(isValidThaiTaxId("010753600010a"), false, "letters");
  assert.equal(isValidThaiTaxId(""), false);
});

test("every single-digit change to a valid tax ID is caught, except the third digit", () => {
  // The third digit has weight 11, and 11 is 0 mod 11, so the check digit cannot see a change there. Known limit of the scheme.
  const valid = "0107536000102";
  for (let index = 0; index < 13; index += 1) {
    if (index === 2) continue;
    for (let digit = 0; digit <= 9; digit += 1) {
      if (String(digit) === valid[index]) continue;
      const changed = valid.slice(0, index) + digit + valid.slice(index + 1);
      assert.equal(isValidThaiTaxId(changed), false, `changed position ${index} to ${digit}`);
    }
  }
});

test("branch numbers are five digits; head office is 00000", () => {
  assert.equal(isValidBranchNo("00000"), true);
  assert.equal(isValidBranchNo("00012"), true);
  assert.equal(isValidBranchNo("123"), false);
  assert.equal(isValidBranchNo("12A45"), false);
  assert.equal(branchLabel("00000"), "สำนักงานใหญ่");
  assert.equal(branchLabel("00012"), "สาขาที่ 00012");
});

// ------------------------------------------------------------------ VAT
test("VAT inside a VAT-inclusive amount is amount x 7 / 107, rounded to the satang", () => {
  assert.equal(vatFromInclusiveSatang(10_700), 700, "107.00 baht includes 7.00 VAT");
  assert.equal(vatFromInclusiveSatang(1_070), 70);
  assert.equal(vatFromInclusiveSatang(0), 0);
  assert.equal(vatFromInclusiveSatang(100_000), Math.round((100_000 * 7) / 107));
});

// ------------------------------------------------------------------ invoice numbers
test("tax invoice numbers are TI-YYYYMM-NNNNN", () => {
  assert.equal(formatTaxInvoiceNumber("2026-10", 7), "TI-202610-00007");
  assert.equal(formatTaxInvoiceNumber("2026-12", 99_999), "TI-202612-99999");
});

// ------------------------------------------------------------------ seller details
test("seller details come from the environment and are refused when incomplete", () => {
  const good = {
    STORE_LEGAL_NAME: "บริษัท ตัวอย่าง จำกัด",
    STORE_TAX_ID: "0107536000102",
    STORE_BRANCH_NO: "00001",
    STORE_ADDRESS: "1 ถนนตัวอย่าง กรุงเทพฯ",
  };
  assert.deepEqual(getSellerInfo(good), {
    name: "บริษัท ตัวอย่าง จำกัด",
    taxId: "0107536000102",
    branch: "00001",
    address: "1 ถนนตัวอย่าง กรุงเทพฯ",
  });
  assert.equal(getSellerInfo({}), null, "nothing set");
  assert.equal(getSellerInfo({ ...good, STORE_TAX_ID: "0107536000103" }), null, "invalid tax ID");
  assert.equal(getSellerInfo({ ...good, STORE_LEGAL_NAME: "" }), null, "no name");
  assert.equal(getSellerInfo({ ...good, STORE_ADDRESS: "" }), null, "no address");
  assert.equal(getSellerInfo({ ...good, STORE_BRANCH_NO: "1" }), null, "bad branch");
  assert.equal(getSellerInfo({ ...good, STORE_BRANCH_NO: undefined })?.branch, "00000", "head office by default");
});

// ------------------------------------------------------------------ end-of-day
function shift(overrides: Partial<EodShiftRow>): EodShiftRow {
  return {
    id: "shift-1",
    cashier: "Cashier",
    openedAt: "2026-10-15T01:00:00.000Z",
    closedAt: "2026-10-15T09:00:00.000Z",
    reviewed: false,
    openingFloat: 100_000,
    expectedCash: 100_000,
    countedCash: 100_000,
    variance: 0,
    note: null,
    ...overrides,
  };
}

function inputs(overrides: Partial<EodInputs> = {}): EodInputs {
  return {
    date: "2026-10-15",
    summary: {
      channels: [
        { method: "CASH", label: "Cash", salesCount: 3, sales: 60_000, refunds: 10_000, net: 50_000 },
        { method: "CARD", label: "Card", salesCount: 2, sales: 30_000, refunds: 0, net: 30_000 },
        { method: "QR_PROMPTPAY", label: "QR", salesCount: 1, sales: 20_000, refunds: 0, net: 20_000 },
      ],
      totals: { sales: 110_000, refunds: 10_000, net: 100_000, saleCount: 6, voidCount: 1, voidAmount: 2_000 },
    },
    shifts: [shift({ id: "a", variance: -500, note: "short 5" }), shift({ id: "b", variance: 200 }), shift({ id: "c", variance: 0 })],
    openShifts: 0,
    taxInvoices: 2,
    ...overrides,
  };
}

test("the Z-report totals match the sales summary and split cash, card and other channels", () => {
  const report = buildEodReport(inputs());
  assert.equal(report.netSales, 100_000);
  assert.equal(report.grossSales, 110_000);
  assert.equal(report.refunds, 10_000);
  assert.equal(report.cash, 50_000);
  assert.equal(report.card, 30_000);
  assert.equal(report.otherChannels, 20_000, "net sales minus cash and card");
  assert.equal(report.cash + report.card + report.otherChannels, report.netSales, "channels add back to net sales");
  assert.equal(report.vat, Math.round((100_000 * 7) / 107));
  assert.equal(report.voidCount, 1);
  assert.equal(report.taxInvoices, 2);
});

test("over and short are totalled separately and net to the difference", () => {
  const report = buildEodReport(inputs());
  assert.equal(report.over, 200);
  assert.equal(report.short, 500);
  assert.equal(report.netVariance, -300);
  assert.equal(report.shiftsClosed, 3);
});

test("the day is ready to file only when no shift is still open", () => {
  assert.equal(buildEodReport(inputs()).readyToFile, true);
  assert.equal(buildEodReport(inputs({ openShifts: 1 })).readyToFile, false);
  assert.equal(buildEodReport(inputs({ openShifts: 2 })).openShifts, 2);
});

test("an empty day reports zeros, not errors", () => {
  const report = buildEodReport(
    inputs({
      summary: { channels: [], totals: { sales: 0, refunds: 0, net: 0, saleCount: 0, voidCount: 0, voidAmount: 0 } },
      shifts: [],
      taxInvoices: 0,
    }),
  );
  assert.equal(report.netSales, 0);
  assert.equal(report.vat, 0);
  assert.equal(report.over + report.short, 0);
  assert.equal(report.readyToFile, true);
});

test("the export has the summary, a blank row, and one row per shift", () => {
  const report = buildEodReport(inputs());
  const out = eodExport(report);
  const netRow = out.rows.find((row) => row[0] === "Net sales");
  assert.equal(netRow?.[1], "1000.00");
  const vatRow = out.rows.find((row) => String(row[0]).startsWith("VAT included"));
  assert.equal(vatRow?.[1], ((Math.round((100_000 * 7) / 107)) / 100).toFixed(2));
  assert.ok(out.rows.some((row) => row.every((cell) => cell === null)), "blank separator row");
  const shiftRows = out.rows.filter((row) => String(row[0]).startsWith("Shift "));
  assert.equal(shiftRows.length, 3);
  assert.equal(shiftRows[0][8], "-5.00", "variance column");
  assert.equal(out.header.length, out.rows[0].length, "every row has the header's width");
});

console.log(`\n${passed} tax and end-of-day groups passed`);
