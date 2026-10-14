// Cash-drawer arithmetic and the role-guard rules. Run with: npx tsx tests/shift.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bahtToSatang, expectedCashSatang, varianceKind, varianceSatang } from "../lib/shift-math";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

test("baht to satang accepts whole and 2-decimal amounts exactly", () => {
  assert.equal(bahtToSatang(0), 0);
  assert.equal(bahtToSatang(1000), 100_000);
  assert.equal(bahtToSatang(1234.56), 123_456);
  assert.equal(bahtToSatang(0.07), 7);
  assert.equal(bahtToSatang(19.99), 1999);
  assert.equal(bahtToSatang(1.1), 110);
});

test("baht to satang rejects negatives, fractions of a satang and non-numbers", () => {
  assert.equal(bahtToSatang(-1), null);
  assert.equal(bahtToSatang(1.234), null);
  assert.equal(bahtToSatang(0.001), null);
  assert.equal(bahtToSatang(Number.NaN), null);
  assert.equal(bahtToSatang(Number.POSITIVE_INFINITY), null);
  assert.equal(bahtToSatang("100"), null);
  assert.equal(bahtToSatang(null), null);
});

test("expected cash = float + cash sales - cash refunds - cash voids", () => {
  assert.equal(expectedCashSatang({ openingFloat: 100_000, cashSales: 120_050, cashRefunds: 25_000, cashVoids: 20_000 }), 175_050);
  assert.equal(expectedCashSatang({ openingFloat: 50_000, cashSales: 0, cashRefunds: 0, cashVoids: 0 }), 50_000);
});

test("a bill voided in the same shift nets to zero in the drawer", () => {
  const withoutVoid = expectedCashSatang({ openingFloat: 100_000, cashSales: 30_000, cashRefunds: 0, cashVoids: 0 });
  const withVoid = expectedCashSatang({ openingFloat: 100_000, cashSales: 30_000 + 20_000, cashRefunds: 0, cashVoids: 20_000 });
  assert.equal(withVoid, withoutVoid);
});

test("variance is counted minus expected, and is classified over, short or balanced", () => {
  assert.equal(varianceSatang(175_050, 175_050), 0);
  assert.equal(varianceSatang(175_000, 175_050), -50);
  assert.equal(varianceSatang(175_100, 175_050), 50);
  assert.equal(varianceKind(0), "BALANCED");
  assert.equal(varianceKind(-50), "SHORT");
  assert.equal(varianceKind(50), "OVER");
});

test("money arithmetic in satang never drifts the way floating point baht would", () => {
  // 0.1 + 0.2 !== 0.3 in floating point. Integer satang is exact.
  const satang = [bahtToSatang(0.1), bahtToSatang(0.2)].map((value) => value ?? 0);
  assert.equal(satang[0] + satang[1], bahtToSatang(0.3));
});

// ------------------------------------------------------------------ role guards
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

test("every /api/admin handler checks for a manager itself, not only the middleware", () => {
  const files = routeFiles(join(__dirname, "..", "app", "api", "admin"));
  assert.ok(files.length >= 20, `expected the admin routes, found ${files.length}`);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const handlers = source.match(HANDLER)?.length ?? 0;
    const guards = source.match(/await requireManager\(\)/g)?.length ?? 0;
    assert.ok(handlers > 0, `${file} exports no handler`);
    assert.equal(guards, handlers, `${file}: ${handlers} handler(s) but ${guards} requireManager() call(s)`);
  }
});

test("the shift routes for cashiers only ever act on the signed-in user's own shift", () => {
  const close = readFileSync(join(__dirname, "..", "app", "api", "shifts", "current", "close", "route.ts"), "utf8");
  assert.ok(close.includes("getOpenShift(tx, auth.user.id)"), "cashier close must look up the caller's own open shift");
  assert.ok(close.includes("requireOwnerId: auth.user.id"), "cashier close must enforce ownership");
});

console.log(`\n${passed} shift and role test groups passed`);
