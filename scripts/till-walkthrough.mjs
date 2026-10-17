// Walks one sale through the till at 1366x768 with headless Chrome: grid, colour and size picker, barcode scan, quantity,
// checkout, quick cash and change. Needs Google Chrome and a till with test stock (scripts/mock-stock.ts).
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' node scripts/till-walkthrough.mjs              stops at the payment screen, saves nothing
//   TILL_USERNAME=admin TILL_PASSWORD='...' node scripts/till-walkthrough.mjs --complete   also presses Enter: a REAL bill is saved
//
// After --complete, remove the test bill and give its stock back with: npx tsx scripts/mock-stock.ts --clear-bills --apply
// Screenshots go to exports/screens. It expects the catalogue of this shop (styles LW262TS116 and LW245KS971).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const COMPLETE = process.argv.includes("--complete");
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = path.resolve(process.cwd(), "exports", "screens") + "/";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.TILL_USERNAME, password: process.env.TILL_PASSWORD }) });
if (!login.ok) throw new Error("login failed " + login.status);
const [cookieName, ...rest] = login.headers.getSetCookie()[0].split(";")[0].split("=");

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "e2e-"))}`,
  "--window-size=1366,768", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

let failures = 0;
const check = (ok, name, detail = "") => { if (!ok) failures++; log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(OUT + name, Buffer.from(s.result.data, "base64")); };
  const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };
  const type = async (text) => { await send("Input.insertText", { text }); };
  const dialogText = () => evaluate(`(document.querySelector('[role=dialog]')?.innerText || '').replace(/\\s+/g, ' ')`);
  const cartText = () => evaluate(`(document.querySelector('section.overflow-hidden ul')?.innerText || '').replace(/\\s+/g, ' ')`);

  await send("Network.enable");
  await send("Network.setCookie", { name: cookieName, value: rest.join("="), url: BASE });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE + "/pos" });
  await sleep(5000);

  // 1. Cards
  const cards = JSON.parse(await evaluate(`JSON.stringify((() => { const g = document.querySelector('[class*=grid-cols-5]'); const kids = [...g.children]; return { n: kids.length, badges: kids.filter(k => k.innerText.includes('OUT OF STOCK')).length, stockLabels: kids.slice(0, 5).map(k => (k.innerText.match(/เหลือ\\s*\\d+/) || [''])[0]) }; })())`));
  check(cards.n === 424, "424 style cards", `${cards.n}`);
  check(cards.badges === 0, "no OUT OF STOCK badge left", `${cards.badges} badges`);
  check(cards.stockLabels.every((s) => /เหลือ\s*\d+/.test(s)), "cards show the remaining stock", cards.stockLabels.join(" | "));
  check(await evaluate(`document.activeElement?.id === 'pos-barcode-input'`), "barcode field has focus on load");
  const payDisabled0 = await evaluate(`[...document.querySelectorAll('button')].find(b => b.className.includes('h-14')).disabled`);
  check(payDisabled0 === true, "pay button is disabled with an empty cart");
  await shot("e2e-1-grid.png");

  // 2. Mouse path: card -> picker -> colour -> size -> add
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('LW262TS116')).click()`);
  await sleep(900);
  let dialog = await dialogText();
  check(dialog.includes('LW262TS116') && /Sand|SAND/i.test(dialog), "picker opens for LW262TS116 with its colours", dialog.slice(0, 90));
  await shot("e2e-2-picker.png");
  const sizeButtons = await evaluate(`[...document.querySelectorAll('[role=dialog] button[aria-pressed]')].map(b => b.innerText.replace(/\\s+/g, ' ').trim() + ':' + b.disabled + ':' + b.getAttribute('aria-pressed'))`);
  log("      picker buttons:", sizeButtons.join(" | "));
  // choose the Sand colour, then size M
  await evaluate(`[...document.querySelectorAll('[role=dialog] button[aria-pressed]')].find(b => /^sand$/i.test(b.innerText.trim())).click()`);
  await sleep(300);
  await evaluate(`[...document.querySelectorAll('[role=dialog] button[aria-pressed]')].find(b => b.innerText.trim().startsWith('M')).click()`);
  await sleep(300);
  const addState = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.className.includes('h-12')); return { disabled: b.disabled, text: b.innerText.replace(/\\s+/g, ' ') }; })()`);
  check(addState.disabled === false, "add-to-cart is enabled once colour and size are chosen", addState.text);
  await shot("e2e-3-picker-chosen.png");
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(x => x.className.includes('h-12')).click()`);
  await sleep(1000);
  let cart = await cartText();
  check(cart.includes('LW262TS116') && cart.includes('M') && cart.includes('1,790.00'), "the picked variant is in the cart at 1,790.00", cart.slice(0, 120));
  check(!(await dialogText()), "the picker closed after adding");
  check(await evaluate(`document.activeElement?.id === 'pos-barcode-input'`), "focus returned to the barcode field after the picker");

  // 3. Scanner path: type fast + Enter, no picker
  await type("LW245KS97140M");
  await key("Enter", "Enter", 13);
  await sleep(1500);
  cart = await cartText();
  check(cart.includes('LW245KS971') && cart.includes('1,290.00'), "a scanned barcode went straight into the cart (sale price 1,290)", cart.slice(0, 200));
  check(!(await dialogText()), "no picker opened for a scan");
  check((await evaluate(`document.getElementById('pos-barcode-input').value`)) === "", "the scan field is empty and ready for the next scan");
  // the same code again increases the quantity
  await type("LW245KS97140M");
  await key("Enter", "Enter", 13);
  await sleep(1200);
  cart = await cartText();
  const qtyOk = await evaluate(`[...document.querySelectorAll('section.overflow-hidden ul li')].some(li => li.innerText.includes('LW245KS971') && /\\n2\\n/.test(li.innerText))`);
  check(qtyOk, "scanning the same code again makes the quantity 2");

  // 4. Totals and checkout
  const totals = await evaluate(`(() => { const t = [...document.querySelectorAll('span')].find(s => s.className.includes('text-[2rem]')); const b = [...document.querySelectorAll('button')].find(b => b.className.includes('h-14')); return { total: t.innerText, payDisabled: b.disabled, pay: b.innerText.replace(/\\s+/g, ' ') }; })()`);
  check(totals.total.includes('4,370.00'), "total = 1,790 + 2 x 1,290 = 4,370.00", totals.total);
  check(totals.payDisabled === false, "pay button is enabled", totals.pay);
  await shot("e2e-4-cart.png");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.className.includes('h-14')).click()`);
  await sleep(2500);
  dialog = await dialogText();
  check(/4,370\.00/.test(dialog), "the checkout dialog shows the amount due 4,370.00", dialog.slice(0, 100));
  const quick = await evaluate(`[...document.querySelectorAll('[role=dialog] button.num')].map(b => b.innerText.trim() + ':' + b.disabled)`);
  log("      quick cash:", quick.join(" | "));
  check(quick.length === 4 && quick[0].endsWith("false") && quick[3].endsWith("true"), "quick-cash: exact is on, 1,000 is greyed (less than the bill)");
  check(await evaluate(`document.activeElement?.type === 'number' && document.activeElement.className.includes('text-xl')`), "the cash-received box has focus");
  await shot("e2e-5-checkout.png");
  // exact, then a larger note typed by hand
  await evaluate(`[...document.querySelectorAll('[role=dialog] button.num')][0].click()`);
  await sleep(500);
  let cash = await evaluate(`document.querySelector('[role=dialog] input[class*=text-xl]').value`);
  check(cash === "4370.00", "exact fills the cash received with 4370.00", cash);
  await evaluate(`(() => { const el = document.querySelector('[role=dialog] input[class*=text-xl]'); el.focus(); el.select(); })()`);
  await type("5000");
  await sleep(500);
  const change = await evaluate(`(document.querySelector('[role=dialog]').innerText.match(/เงินทอน\\s*฿?([\\d,.]+)/) || [])[1] || ''`);
  check(change === "630.00", "paying 5,000 shows change 630.00 at once", change);
  await shot("e2e-6-change.png");

  if (COMPLETE) {
    await key("Enter", "Enter", 13);
    await sleep(4000);
    dialog = await dialogText();
    check(/สำเร็จ|ใบเสร็จ|POS-\d{8}-\d{4}|Sale complete|Receipt/i.test(dialog), "Enter completed the sale and the receipt appeared", dialog.slice(0, 120));
    await shot("e2e-7-receipt.png");
    await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => /ขายใหม่|new sale/i.test(b.innerText)).click()`);
    await sleep(1200);
    check(await evaluate(`document.activeElement?.id === 'pos-barcode-input'`), "after the sale the cursor is back in the barcode field", await evaluate(`document.activeElement?.id || document.activeElement?.tagName`));
    check((await evaluate(`document.querySelectorAll('section.overflow-hidden ul li').length`)) === 0, "the cart is empty for the next customer");
  } else {
    log("      (not completing the sale; run with --complete to press Enter)");
  }
  ws.close();
} finally {
  chrome.kill();
}
log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failures ? 1 : 0;
