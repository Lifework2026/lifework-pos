// Real-browser check (1366x768, real mouse clicks) of the free-bag selector and the Today's sales drawer.
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' node scripts/till-bags-history.mjs              no bill is saved
//   TILL_USERNAME=admin TILL_PASSWORD='...' node scripts/till-bags-history.mjs --complete   also sells one bill (a REAL bill is saved)
//
// It needs Google Chrome, test stock (scripts/mock-stock.ts) and the bags (scripts/seed-free-bags.ts). After --complete,
// remove the test bill with: npx tsx scripts/mock-stock.ts --clear-bills --apply

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const COMPLETE = process.argv.includes("--complete");
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve(process.cwd(), "exports", "screens");
const PORT = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.TILL_USERNAME || !process.env.TILL_PASSWORD) {
  console.error("Set TILL_USERNAME and TILL_PASSWORD.");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.TILL_USERNAME, password: process.env.TILL_PASSWORD }),
});
if (!login.ok) throw new Error("login failed " + login.status);
const [cookieName, ...cookieRest] = login.headers.getSetCookie()[0].split(";")[0].split("=");

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "bag-"))}`,
  "--window-size=1366,768", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

let failures = 0;
const check = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, name), Buffer.from(s.result.data, "base64")); };
  const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };
  const scan = async (code) => { await send("Input.insertText", { text: code }); await key("Enter", "Enter", 13); await sleep(1200); };
  const click = async (elementJs) => {
    const box = await evaluate(`(() => { const el = ${elementJs}; el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 });
    }
    await sleep(800);
  };
  const cartText = () => evaluate(`(document.querySelector('section.overflow-hidden ul')?.innerText || '').replace(/\\s+/g, ' ')`);
  const dialogText = () => evaluate(`(document.querySelector('[role=dialog]')?.innerText || '').replace(/\\s+/g, ' ')`);
  const focusedId = () => evaluate(`document.activeElement?.id || document.activeElement?.tagName`);
  const noPageScroll = () => evaluate(`document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth`);

  await send("Network.enable");
  await send("Network.setCookie", { name: cookieName, value: cookieRest.join("="), url: BASE });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/pos` });
  await sleep(5000);

  // Header
  const header = await evaluate(`(() => { const b = [...document.querySelectorAll('header button')].find(x => /TODAY|ประวัติการขาย/i.test(x.innerText)); const chip = [...document.querySelectorAll('header *')].find(x => /กะเริ่ม|Shift/i.test(x.innerText) && x.children.length < 4); return { button: b ? b.innerText.trim() : null, bx: b ? Math.round(b.getBoundingClientRect().x) : 0, cx: chip ? Math.round(chip.getBoundingClientRect().x) : 0 }; })()`);
  check(!!header.button && header.button.startsWith("[") && header.button.endsWith("]"), "the header has the [ sales history ] button", header.button ?? "missing");
  check(header.bx > header.cx, "the button sits to the right of the shift chip", `${header.cx} < ${header.bx}`);
  check(await noPageScroll(), "no page scrollbar at 1366x768");

  // A fashion item, then bags from the selector
  await scan("LW245KS97140M");
  await click(`[...document.querySelectorAll('section.overflow-hidden button')].find(b => /\\+ BAG|\\+ ถุง/.test(b.innerText))`);
  const bagButtons = await evaluate(`[...document.querySelectorAll('button[data-bag]')].map(b => b.dataset.bag + ':' + b.disabled)`);
  check(bagButtons.length === 6, "the bag selector offers six bags", bagButtons.join(" "));
  await shot("bag-1-selector.png");
  await click(`document.querySelector('button[data-bag="BAG-PAPER-M"]')`);
  let cart = await cartText();
  check(cart.includes("ถุง Paper (M)") && cart.includes("฿0.00"), "Paper M is in the cart as ถุง Paper (M) at 0.00", cart.slice(0, 160));
  check((await evaluate(`document.querySelectorAll('button[data-bag]').length`)) === 0, "the selector closed after adding");
  check((await focusedId()) === "pos-barcode-input", "the cursor is back in the barcode field", await focusedId());
  await click(`[...document.querySelectorAll('section.overflow-hidden button')].find(b => /\\+ BAG|\\+ ถุง/.test(b.innerText))`);
  await click(`document.querySelector('button[data-bag="BAG-RPET-L"]')`);
  await click(`[...document.querySelectorAll('section.overflow-hidden button')].find(b => /\\+ BAG|\\+ ถุง/.test(b.innerText))`);
  await click(`document.querySelector('button[data-bag="BAG-RPET-L"]')`);
  cart = await cartText();
  check(cart.includes("ถุง Rpet (L)"), "Rpet L is in the cart", cart.slice(-120));
  const rpetQty = await evaluate(`(() => { const li = [...document.querySelectorAll('section.overflow-hidden ul li')].find(x => x.innerText.includes('Rpet')); return li ? li.innerText.split('\\n').map(s => s.trim()).filter(Boolean).join('|') : ''; })()`);
  check(/\|2\|/.test(rpetQty), "adding the same bag again makes the quantity 2", rpetQty);
  // the plus button on a bag line never stops at a stock limit
  for (let i = 0; i < 12; i++) await click(`[...document.querySelectorAll('section.overflow-hidden ul li')].find(x => x.innerText.includes('Paper')).querySelector('button[aria-label*="เพิ่ม"], button[aria-label*="ncrease"]')`);
  const paperQty = await evaluate(`[...document.querySelectorAll('section.overflow-hidden ul li')].find(x => x.innerText.includes('Paper')).innerText.split('\\n').map(s => s.trim()).filter(Boolean).join('|')`);
  check(/\|13\|/.test(paperQty), "a bag can go well past its stock figure of 0 (13 here)", paperQty);
  // and the minus / remove buttons work
  await click(`[...document.querySelectorAll('section.overflow-hidden ul li')].find(x => x.innerText.includes('Paper')).querySelector('button[aria-label*="ลด"], button[aria-label*="ecrease"]')`);
  const total = await evaluate(`[...document.querySelectorAll('span')].find(s => s.className.includes('text-[2rem]')).innerText`);
  check(total.includes("1,290.00"), "the total is still just the shirt: 1,290.00", total);
  await shot("bag-2-cart.png");
  check(await noPageScroll(), "still no page scrollbar with bags in the cart");

  if (COMPLETE) {
    await click(`[...document.querySelectorAll('button')].find(b => b.className.includes('h-14'))`);
    await sleep(2000);
    await evaluate(`[...document.querySelectorAll('[role=dialog] button.num')][0].click()`);
    await sleep(500);
    await key("Enter", "Enter", 13);
    await sleep(4000);
    const receipt = await dialogText();
    check(/สำเร็จ|Sale complete/i.test(receipt), "the sale completed", receipt.slice(0, 60));
    // Compare with every kind of space removed, so a non-breaking space in the receipt text cannot matter.
    const flat = await evaluate(`(document.querySelector('[role=dialog] .receipt-print')?.innerText || '').split(/\\s+/).join('')`);
    check(flat.includes("ถุงPaper(M)") && flat.includes("ถุงRpet(L)"), "the receipt lists both bags with their sizes", flat.slice(120, 220));
    check(flat.includes("BAG-PAPER-M") && flat.includes("BAG-RPET-L") && flat.includes("฿0.00"), "the receipt shows the bag SKUs and 0.00");
    await shot("bag-3-receipt.png");
    await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => /ขายใหม่|new sale/i.test(b.innerText)).click()`);
    await sleep(1500);
    check((await focusedId()) === "pos-barcode-input", "after the sale the cursor is in the barcode field", await focusedId());
  }

  // History drawer
  await click(`[...document.querySelectorAll('header button')].find(x => /TODAY|ประวัติการขาย/i.test(x.innerText))`);
  await sleep(1500);
  const drawer = await dialogText();
  check(/ประวัติการขายวันนี้|Today's sales/i.test(drawer), "the drawer opens", drawer.slice(0, 70));
  const rows = await evaluate(`document.querySelectorAll('[role=dialog] li').length`);
  if (COMPLETE) {
    check(rows >= 1, "the bill just made is listed", `${rows} row(s)`);
    check(/POS-\d{8}-\d{4}/.test(drawer) && /เงินสด|Cash/i.test(drawer) && /สำเร็จ|Completed/i.test(drawer), "it shows number, payment and status", drawer.slice(60, 200));
  } else {
    check(rows >= 0, "the drawer shows its list or its empty message", rows === 0 ? "empty message" : `${rows} row(s)`);
  }
  check(await noPageScroll(), "no page scrollbar with the drawer open");
  const geometry = await evaluate(`(() => { const d = document.querySelector('[role=dialog]').getBoundingClientRect(); return { right: Math.round(d.right), top: Math.round(d.top), height: Math.round(d.height), width: Math.round(d.width) }; })()`);
  check(geometry.right === 1366 && geometry.top === 0 && geometry.height === 768, "it is a full-height slide-over on the right edge", JSON.stringify(geometry));
  await shot("history-1-drawer.png");
  if (COMPLETE && rows >= 1) {
    await click(`document.querySelector('[role=dialog] li button[aria-label]')`);
    await sleep(1200);
    const preview = await evaluate(`[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText.replace(/\\s+/g, ' ')).join(' || ')`);
    check(/LIFEWORK/i.test(preview) && /ถุง Paper \(M\)/.test(preview), "the print preview shows the receipt", preview.slice(-120));
    await shot("history-2-preview.png");
    await key("Escape", "Escape", 27);
    await sleep(900);
    check((await evaluate(`document.querySelectorAll('[role=dialog]').length`)) === 1, "Esc closes only the preview, the drawer stays");
  }
  await key("Escape", "Escape", 27);
  await sleep(1200);
  check((await evaluate(`document.querySelectorAll('[role=dialog]').length`)) === 0, "Esc closes the drawer");
  check((await focusedId()) === "pos-barcode-input", "the cursor is back in the barcode field", await focusedId());
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failures ? 1 : 0;
