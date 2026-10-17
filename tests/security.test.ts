// Guards for the till and back-office rules. Static checks on the source, so a later edit that drops a guard
// fails the build. Run with: npx tsx tests/security.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

test("manual card entry is a manager action on the server", () => {
  const source = read("app/api/edc/payments/manual/route.ts");
  assert.ok(source.includes("await requireManager()"), "manual route must require a manager");
  assert.ok(!source.includes("getCurrentSession()"), "manual route must not fall back to any signed-in user");
});

test("manual card entry is hidden from cashiers in the till", () => {
  const source = read("components/pos/card-payment-line.tsx");
  assert.ok(source.includes("const canManual = canManage(useSessionUser()?.role)"));
  assert.ok(source.includes("{canManual && !manualOpen && !approved ? ("), "manual toggle must be gated");
  assert.ok(source.includes("{canManual && manualOpen ? ("), "manual form must be gated");
});

test("member registration is a manager action on the server; lookup stays open", () => {
  const source = read("app/api/members/route.ts");
  const post = source.slice(source.indexOf("export async function POST"));
  assert.ok(post.includes("await requireManager()"), "POST /api/members must require a manager");
  const get = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
  assert.ok(get.includes("getCurrentSession()"), "member lookup must stay open to signed-in staff");
});

test("member registration is hidden from cashiers in the till", () => {
  const source = read("components/pos/member-picker.tsx");
  assert.ok(source.includes("canRegister ? ("), "the register button must be gated");
});

test("sign-out is refused while the user has an open shift", () => {
  const source = read("app/api/auth/logout/route.ts");
  assert.ok(source.includes('status: "OPEN"'), "logout must check for an open shift");
  assert.ok(source.includes("409"), "logout must answer 409 when a shift is open");
  const button = read("components/auth/sign-out-button.tsx");
  assert.ok(button.includes("res.status === 409"), "the sign-out button must handle the 409");
});

test("every payment, void, refund and shift action locks against a second tap", () => {
  assert.ok(read("components/pos/checkout-dialog.tsx").includes("submitLock.current"), "checkout");
  assert.ok(read("components/admin/void-dialog.tsx").includes("submitLock.current"), "void");
  assert.ok(read("components/admin/refund-dialog.tsx").includes("submitLock.current"), "refund");
  const shift = read("components/pos/shift-manager.tsx");
  assert.ok(shift.includes("busyRef.current") && shift.includes("submitOpen") && shift.includes("submitClose"), "shift open and close");
});

test("the checkout writes stock, order, payments and ledger in one serializable transaction", () => {
  const source = read("app/api/orders/checkout/route.ts");
  assert.ok(source.includes("prisma.$transaction((tx) => placeOrder(tx, parsed.data, session.id)"));
  assert.ok(source.includes("TransactionIsolationLevel.Serializable"));
  const place = source.slice(source.indexOf("async function placeOrder"), source.indexOf("function handleError"));
  assert.ok(place.includes("tx.productVariant.updateMany") && place.includes("tx.inventoryMovement.createMany") && place.includes("tx.payment.createMany"));
});

test("the phone prefix index is declared in the schema and in a migration", () => {
  const schema = read("prisma/schema.prisma");
  assert.ok(schema.includes('@@index([phone(ops: raw("text_pattern_ops"))])'));
  const migration = read("prisma/migrations/20261017000000_member_phone_prefix_index/migration.sql");
  assert.ok(migration.includes('CREATE INDEX "Member_phone_idx" ON "Member"("phone" text_pattern_ops);'));
});

test("tax invoices are issued by managers only, and the route refuses without seller details", () => {
  const source = read("app/api/admin/orders/[id]/tax-invoice/route.ts");
  assert.ok(source.includes("await requireManager()"), "tax invoice route must require a manager");
  assert.ok(source.includes("getSellerInfo()"), "tax invoice route must check the seller details first");
  assert.ok(source.includes("TransactionIsolationLevel.Serializable"), "numbering must be serializable");
});

test("the end-of-day report and its export are manager-only", () => {
  assert.ok(read("app/api/admin/export/route.ts").includes("await requireManager()"));
  const page = read("app/admin/eod/page.tsx");
  assert.ok(page.includes("buildEod(date)"), "the EOD page reads the database through buildEod");
  assert.ok(read("middleware.ts").includes('pathname.startsWith("/admin")'), "/admin is guarded by the middleware");
});

test("every payment, void, refund and shift button is disabled while offline", () => {
  assert.ok(read("components/pos/checkout-dialog.tsx").includes("online &&"), "pay");
  assert.ok(read("components/pos/cart-panel.tsx").includes("!online"), "cart checkout");
  assert.ok(read("components/admin/void-dialog.tsx").includes("!online"), "void");
  assert.ok(read("components/admin/refund-dialog.tsx").includes("online && hasSelection"), "refund");
  const shift = read("components/pos/shift-manager.tsx");
  assert.ok(shift.includes("busy || !online"), "shift open and close");
  assert.ok(read("components/admin/orders-table.tsx").includes("disabled={!online}"), "sales actions");
  assert.ok(read("components/admin/tax-invoice-dialog.tsx").includes("!online"), "tax invoice");
});

test("the offline banner is mounted for every page", () => {
  assert.ok(read("app/layout.tsx").includes("<NetworkProvider>"));
  assert.ok(read("components/network-status.tsx").includes("No Internet Connection - System Paused"));
});

test("printing tax invoices uses the A4 page and the receipt roll rule is gone", () => {
  const css = read("app/globals.css");
  assert.ok(css.includes("@page a4-document"), "A4 page rule");
  assert.ok(!css.includes("size: 80mm auto"), "the invalid receipt page rule must stay removed");
  assert.ok(read("components/pos/print-receipt.tsx").includes('"a4"'));
});

test("master-data codes: colour routes are manager-only and categories require a code", () => {
  for (const file of ["app/api/admin/colors/route.ts", "app/api/admin/colors/[id]/route.ts"]) {
    assert.ok(read(file).includes("await requireManager()"), file + " must require a manager");
  }
  const createSchema = read("app/api/admin/categories/route.ts");
  assert.ok(createSchema.includes("code: categoryCodeSchema"), "a category needs a code");
  assert.ok(read("lib/master-schema.ts").includes("isValidCode"), "codes are checked with the shared rule");
});

console.log(`\n${passed} security guard groups passed`);
