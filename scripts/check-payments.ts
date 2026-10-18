// Rings up one sale through every payment channel against a running server, and checks what the till would print.
// A REAL TEST: it writes bills (and card references) into whatever database the server uses. Run it on the test
// stock, then remove the bills with: npx tsx scripts/mock-stock.ts --clear-bills --apply
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' npx tsx scripts/check-payments.ts                 against http://localhost:3000
//
// It needs the signed-in account to have an open shift. The card sales are made the way the shop will make them: the
// cashier types the slip reference (EDC_MODE=manual), then the bill is paid with that approved reference.
//
// Checked: cash with change, card by slip reference, PromptPay QR and bank transfer with a reference, "other", a split of
// cash and card, a free bag on the bill, a reused slip reference being refused, a card line with no slip refused, a QR
// with no reference refused, and cash that is too little refused.

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const run = Date.now().toString(36).toUpperCase();

let failures = 0;
const check = (ok: boolean, name: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

let cookie = "";
async function call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${url}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

interface Found {
  id: string;
  price: number;
  stock: number;
  sku: string;
}

async function main(): Promise<void> {
  const username = process.env.TILL_USERNAME;
  const password = process.env.TILL_PASSWORD;
  if (!username || !password) throw new Error("Set TILL_USERNAME and TILL_PASSWORD.");
  const login = await fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!login.ok) throw new Error(`login failed ${login.status}`);
  cookie = login.headers.getSetCookie()[0].split(";")[0];

  const mode = await call("GET", "/api/edc/mode");
  check(mode.status === 200 && typeof mode.body?.mode === "string", "the till can ask how card payments are taken", mode.body?.mode);
  const started = await call("POST", "/api/edc/payments", { amount: 100 });
  if (mode.body?.mode === "manual") check(started.status === 409 && started.body?.error === "EDC_MANUAL_MODE", "in manual mode nothing is sent to a terminal, and the answer says to use the slip", `${started.status} ${started.body?.error}`);

  const shift = await call("GET", "/api/shifts/current");
  check(shift.status === 200 && !!shift.body?.shift, "a shift is open", shift.body?.shift ? "" : "open one first");

  // Two ordinary products with stock, and a free bag.
  const found: Found[] = [];
  for (const barcode of (process.env.TEST_BARCODES ?? "").split(",").filter(Boolean)) {
    const r = await call("GET", `/api/products/search?barcode=${encodeURIComponent(barcode)}`);
    if (r.status === 200) found.push({ id: r.body.variant.id, price: Number(r.body.variant.price), stock: r.body.variant.stockQuantity, sku: r.body.variant.sku });
  }
  if (found.length < 2) throw new Error("Set TEST_BARCODES to two or more barcodes of products with stock.");
  const [a, b] = found;
  const bag = await call("GET", "/api/products/search?barcode=BAG-PAPER-S");
  const bagItem = bag.status === 200 ? [{ variantId: bag.body.variant.id, quantity: 1, unitPrice: 0 }] : [];
  check(bag.status === 200, "the free paper bag can be scanned", bag.body?.error ?? "");

  const items = (...picks: Found[]) => [...picks.map((p) => ({ variantId: p.id, quantity: 1, unitPrice: p.price })), ...bagItem];
  const base = { bag: "NONE", redeemPoints: 0, manualDiscount: 0 };
  const total = (...picks: Found[]) => picks.reduce((sum, p) => sum + p.price, 0);

  async function checkout(name: string, picks: Found[], payments: unknown[], expect = 201) {
    const r = await call("POST", "/api/orders/checkout", { ...base, items: items(...picks), payments });
    check(r.status === expect, name, `${r.status} ${r.body?.error ?? r.body?.order?.receiptNo ?? ""}`);
    return r;
  }
  const slip = (n: number) => `TEST${run}${n}`;
  async function approvedCard(amount: number, ref: string) {
    const r = await call("POST", "/api/edc/payments/manual", { amount, transactionRef: ref, approvalCode: "123456" });
    check(r.status === 201 && r.body?.payment?.status === "SUCCESS", `slip reference ${ref} is recorded as an approved card payment`, `${r.status} ${r.body?.error ?? ""}`);
    return r.body?.payment?.id as string;
  }

  const stockBefore = a.stock;

  // 1. Cash with change.
  const cash = await checkout("cash with change", [a], [{ method: "CASH", amount: total(a), tendered: total(a) + 500 }]);
  const cashPay = cash.body?.order?.payments?.[0];
  check(Number(cashPay?.changeGiven) === 500, "the change is worked out", `${cashPay?.changeGiven}`);

  // 2. Card by slip reference, and the same slip cannot pay a second bill.
  const cardId = await approvedCard(total(b), slip(1));
  const cardSale = await checkout("card by slip reference", [b], [{ method: "CARD", amount: total(b), edcPaymentId: cardId }]);
  check(cardSale.body?.order?.payments?.[0]?.edcRef?.transactionRef === slip(1), "the slip reference is on the bill, for the receipt and the books", `${cardSale.body?.order?.payments?.[0]?.edcRef?.transactionRef}`);
  await checkout("the same card payment cannot pay a second bill", [b], [{ method: "CARD", amount: total(b), edcPaymentId: cardId }], 409);
  const dup = await call("POST", "/api/edc/payments/manual", { amount: 10, transactionRef: slip(1) });
  check(dup.status === 409 && dup.body?.error === "REFERENCE_ALREADY_USED", "a slip reference typed twice is refused with a clear message", `${dup.status}`);
  const wrong = await approvedCard(5, slip(2));
  await checkout("a card payment of another amount does not match the bill", [b], [{ method: "CARD", amount: total(b), edcPaymentId: wrong }], 409);
  await checkout("a card line with no slip is refused", [b], [{ method: "CARD", amount: total(b) }], 400);

  // 3. QR and bank transfer need a reference; OTHER does not.
  await checkout("PromptPay QR with a reference", [a], [{ method: "QR_PROMPTPAY", amount: total(a), reference: `QR${run}1` }]);
  await checkout("PromptPay QR with no reference is refused", [a], [{ method: "QR_PROMPTPAY", amount: total(a) }], 400);
  await checkout("bank transfer with a reference", [b], [{ method: "BANK_TRANSFER", amount: total(b), reference: `TR${run}1` }]);
  await checkout("other payment", [a], [{ method: "OTHER", amount: total(a) }]);

  // 4. Split: part cash, part card.
  const half = Math.round(total(a, b) / 2);
  const splitCard = await approvedCard(total(a, b) - half, slip(3));
  const split = await checkout("split cash and card", [a, b], [{ method: "CASH", amount: half, tendered: half }, { method: "CARD", amount: total(a, b) - half, edcPaymentId: splitCard }]);
  check(split.body?.order?.payments?.length === 2, "the split bill carries both payment lines", `${split.body?.order?.payments?.length}`);

  // 5. Cash that is too little.
  await checkout("cash short of the bill is refused", [a], [{ method: "CASH", amount: total(a), tendered: total(a) - 1 }], 400);

  // 6. Stock fell by the number of bills that sold product a, and the free bag did not touch stock.
  const after = await call("GET", `/api/products/search?barcode=${encodeURIComponent(process.env.TEST_BARCODES!.split(",")[0])}`);
  // a was sold in: cash, QR, other, split = 4 bills
  check(after.body?.variant?.stockQuantity === stockBefore - 4, "stock went down once for each bill that sold the product", `${stockBefore} -> ${after.body?.variant?.stockQuantity}`);
  if (bag.status === 200) check(bag.body.variant.stockQuantity === (await call("GET", "/api/products/search?barcode=BAG-PAPER-S")).body.variant.stockQuantity, "the free bag is not counted in stock");

  const today = await call("GET", "/api/orders/today");
  check(today.status === 200, "today's sales list loads", `${today.body?.orders?.length ?? "?"} bills`);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  console.log("These were real bills. Remove them with: npx tsx scripts/mock-stock.ts --clear-bills --apply");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
