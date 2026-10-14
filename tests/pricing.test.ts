/**
 * Pricing engine tests. Run with: npm test
 * Uses node:assert only, so there is no test framework to install.
 */
import assert from "node:assert/strict";
import {
  allocate,
  bahtToSatang,
  calculatePricing,
  PricingError,
  allocateRefund,
  refundShare,
  satangToDecimal,
  type PricingInput,
} from "../lib/pricing";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const base = (overrides: Partial<PricingInput>): PricingInput => ({
  lines: [],
  pointValueSatang: 100,
  earnThresholdSatang: 10_000,
  isMember: false,
  ...overrides,
});

test("no discounts: total equals subtotal", () => {
  const r = calculatePricing(
    base({
      lines: [
        { key: "a", unitPriceSatang: 89_000, quantity: 2, isBag: false, promoEligible: true },
      ],
    }),
  );
  assert.equal(r.subtotal, 178_000);
  assert.equal(r.total, 178_000);
  assert.equal(r.discount, 0);
  assert.equal(r.pointsEarned, 0);
});

test("10% promotion on two lines splits exactly", () => {
  const r = calculatePricing(
    base({
      lines: [
        { key: "shirt", unitPriceSatang: 89_000, quantity: 1, isBag: false, promoEligible: true },
        { key: "pants", unitPriceSatang: 35_000, quantity: 1, isBag: false, promoEligible: true },
      ],
      promotion: { name: "10% off", kind: "PERCENT_OFF", valueScaled: 1000, minSubtotalSatang: 0 },
    }),
  );
  assert.equal(r.promotionDiscount, 12_400);
  assert.equal(r.discount, 12_400);
  assert.equal(r.total, 111_600);
  assert.equal(r.lines.reduce((s, l) => s + l.discount, 0), 12_400);
  assert.equal(r.lines.reduce((s, l) => s + l.net, 0), 111_600);
});

test("allocation of an odd satang across three lines still sums exactly", () => {
  const shares = allocate(BigInt(100), [BigInt(1), BigInt(1), BigInt(1)]);
  assert.deepEqual(shares.map(Number), [34, 33, 33]);
  assert.equal(shares.reduce((s, v) => s + v, BigInt(0)), BigInt(100));
});

test("promotion excludes bag lines and non-eligible lines", () => {
  const r = calculatePricing(
    base({
      lines: [
        { key: "shirt", unitPriceSatang: 100_000, quantity: 1, isBag: false, promoEligible: true },
        { key: "pants", unitPriceSatang: 100_000, quantity: 1, isBag: false, promoEligible: false },
        { key: "bag", unitPriceSatang: 500, quantity: 1, isBag: true, promoEligible: true },
      ],
      promotion: { name: "Shirts 20%", kind: "PERCENT_OFF", valueScaled: 2000, minSubtotalSatang: 0 },
    }),
  );
  assert.equal(r.promotionDiscount, 20_000);
  assert.equal(r.lines[1].discount, 0);
  assert.equal(r.lines[2].discount, 0);
});

test("amount-off promotion is capped at the eligible base", () => {
  const r = calculatePricing(
    base({
      lines: [
        { key: "a", unitPriceSatang: 30_000, quantity: 1, isBag: false, promoEligible: true },
        { key: "b", unitPriceSatang: 10_000, quantity: 1, isBag: false, promoEligible: false },
      ],
      promotion: { name: "500 off", kind: "AMOUNT_OFF", valueScaled: 50_000, minSubtotalSatang: 0 },
    }),
  );
  assert.equal(r.promotionDiscount, 30_000);
  assert.equal(r.total, 10_000);
});

test("promotion below minimum subtotal is rejected", () => {
  assert.throws(
    () =>
      calculatePricing(
        base({
          lines: [{ key: "a", unitPriceSatang: 50_000, quantity: 1, isBag: false, promoEligible: true }],
          promotion: { name: "Spend 1000", kind: "PERCENT_OFF", valueScaled: 1000, minSubtotalSatang: 100_000 },
        }),
      ),
    (e: unknown) => e instanceof PricingError && e.code === "PROMOTION_NOT_APPLICABLE",
  );
});

test("member discount applies to merchandise only, after promotion", () => {
  // 1000 baht shirt, 10% promo -> 900, member 5% -> 45 off. Bag (50 baht) gets no member discount.
  const r = calculatePricing(
    base({
      lines: [
        { key: "shirt", unitPriceSatang: 100_000, quantity: 1, isBag: false, promoEligible: true },
        { key: "bag", unitPriceSatang: 5_000, quantity: 1, isBag: true, promoEligible: false },
      ],
      promotion: { name: "10%", kind: "PERCENT_OFF", valueScaled: 1000, minSubtotalSatang: 0 },
      memberDiscountScaled: 500,
      isMember: true,
    }),
  );
  assert.equal(r.promotionDiscount, 10_000);
  assert.equal(r.memberDiscount, 4_500);
  assert.equal(r.lines[1].memberDiscount, 0);
  assert.equal(r.total, 100_000 - 10_000 - 4_500 + 5_000);
});

test("points redemption reduces the total and is allocated", () => {
  const r = calculatePricing(
    base({
      lines: [
        { key: "a", unitPriceSatang: 60_000, quantity: 1, isBag: false, promoEligible: true },
        { key: "b", unitPriceSatang: 40_000, quantity: 1, isBag: false, promoEligible: true },
      ],
      isMember: true,
      pointsToRedeem: 50,
      pointsBalance: 80,
    }),
  );
  assert.equal(r.pointsDiscount, 5_000);
  assert.equal(r.total, 95_000);
  assert.equal(r.lines.reduce((s, l) => s + l.pointsDiscount, 0), 5_000);
  // 95,000 merchandise net -> 9 points earned (floor of 950 baht / 100)
  assert.equal(r.pointsEarned, 9);
});

test("points earned use the net paid merchandise, not the gross", () => {
  const r = calculatePricing(
    base({
      lines: [{ key: "a", unitPriceSatang: 200_000, quantity: 1, isBag: false, promoEligible: true }],
      promotion: { name: "50%", kind: "PERCENT_OFF", valueScaled: 5000, minSubtotalSatang: 0 },
      isMember: true,
    }),
  );
  assert.equal(r.total, 100_000);
  assert.equal(r.pointsEarned, 10);
});

test("manual discount larger than the payable amount is rejected", () => {
  assert.throws(
    () =>
      calculatePricing(
        base({
          lines: [{ key: "a", unitPriceSatang: 10_000, quantity: 1, isBag: false, promoEligible: true }],
          manualDiscountSatang: 10_001,
        }),
      ),
    (e: unknown) => e instanceof PricingError && e.code === "DISCOUNT_EXCEEDS_TOTAL",
  );
});

test("redeeming more points than the balance is rejected", () => {
  assert.throws(
    () =>
      calculatePricing(
        base({
          lines: [{ key: "a", unitPriceSatang: 10_000, quantity: 1, isBag: false, promoEligible: true }],
          isMember: true,
          pointsToRedeem: 11,
          pointsBalance: 10,
        }),
      ),
    (e: unknown) => e instanceof PricingError && e.code === "POINTS_EXCEED_BALANCE",
  );
});

test("zero payable total is rejected", () => {
  assert.throws(
    () =>
      calculatePricing(
        base({
          lines: [{ key: "a", unitPriceSatang: 10_000, quantity: 1, isBag: false, promoEligible: true }],
          manualDiscountSatang: 10_000,
        }),
      ),
    (e: unknown) => e instanceof PricingError && e.code === "EMPTY_TOTAL",
  );
});

test("refund shares add up exactly to the line net after every unit is returned", () => {
  const net = 33_333; // awkward number on purpose
  const original = 3;
  let refunded = 0;
  let sum = 0;
  for (const next of [1, 2, 3]) {
    sum += refundShare(net, original, refunded, next);
    refunded = next;
  }
  assert.equal(sum, net);
  assert.equal(refundShare(net, original, 0, 1), 11_111);
});

test("refunds return to the original payment lines in paid order", () => {
  const slots = [
    { key: "cash", amountSatang: 50_000, refundedSatang: 0 },
    { key: "qr", amountSatang: 102_390, refundedSatang: 0 },
  ];
  assert.deepEqual(allocateRefund(76_095, slots), [
    { key: "cash", amountSatang: 50_000 },
    { key: "qr", amountSatang: 26_095 },
  ]);
  const partly = [
    { key: "cash", amountSatang: 50_000, refundedSatang: 50_000 },
    { key: "qr", amountSatang: 102_390, refundedSatang: 26_095 },
  ];
  assert.deepEqual(allocateRefund(76_295, partly), [{ key: "qr", amountSatang: 76_295 }]);
  assert.throws(() => allocateRefund(76_296, partly), (e: unknown) => e instanceof PricingError && e.code === "REFUND_EXCEEDS_PAYMENTS");
});

test("baht and satang conversion", () => {
  assert.equal(bahtToSatang("890"), 89_000);
  assert.equal(bahtToSatang("890.5"), 89_050);
  assert.equal(bahtToSatang(12.34), 1_234);
  assert.equal(satangToDecimal(89_005), "890.05");
  assert.equal(satangToDecimal(5), "0.05");
  assert.throws(() => bahtToSatang("1.234"), PricingError);
});

test("randomised: every satang is accounted for and no net is negative", () => {
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  let cases = 0;
  for (let i = 0; i < 3000; i++) {
    const lineCount = 1 + rand(6);
    const lines = Array.from({ length: lineCount }, (_, idx) => ({
      key: `l${idx}`,
      unitPriceSatang: 100 + rand(500_000),
      quantity: 1 + rand(5),
      isBag: rand(5) === 0,
      promoEligible: rand(2) === 0,
    }));
    const subtotal = lines.reduce((s, l) => s + l.unitPriceSatang * l.quantity, 0);
    const input = base({
      lines,
      promotion: rand(2) ? { name: "p", kind: rand(2) ? "PERCENT_OFF" : "AMOUNT_OFF", valueScaled: rand(2) ? rand(3000) : rand(subtotal + 1), minSubtotalSatang: 0 } : null,
      isMember: rand(2) === 0,
      memberDiscountScaled: rand(2) ? rand(1000) : 0,
      manualDiscountSatang: rand(3) === 0 ? rand(Math.max(1, subtotal / 10)) : 0,
    });
    input.pointsBalance = 1000;
    input.pointsToRedeem = rand(3) === 0 ? rand(200) : 0;
    try {
      const r = calculatePricing(input);
      cases += 1;
      assert.equal(r.subtotal, subtotal);
      assert.equal(r.subtotal - r.discount, r.total, "subtotal - discount must equal total");
      assert.equal(
        r.lines.reduce((s, l) => s + l.net, 0),
        r.total,
        "line nets must sum to total",
      );
      assert.equal(
        r.lines.reduce((s, l) => s + l.discount, 0),
        r.discount,
        "line discounts must sum to discount",
      );
      for (const l of r.lines) {
        assert.ok(l.net >= 0, "line net must not be negative");
        assert.equal(l.subtotal - l.discount, l.net);
      }
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
    }
  }
  assert.ok(cases > 1000, "most random baskets should price successfully");
  console.log(`      (${cases} random baskets checked)`);
});

console.log(`\n${passed} pricing test groups passed`);
