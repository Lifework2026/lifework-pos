// Checks, with a real browser at 1366x768 and real mouse clicks, the things that went wrong at the till before:
//   - a scan after a bill line was removed, or the cart cleared, must still land in the barcode field (no F5 needed)
//   - searching must find a style even if a category was chosen earlier
//   - the category strip has an arrow for each direction once it has been moved
// Nothing is saved: the cart lives in the browser and no bill is made. Needs Google Chrome.
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' node scripts/till-regressions.mjs      (server on http://localhost:3000, or BASE_URL)
//   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"             if Chrome is somewhere else

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "reg-"))}`,
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
  /** A real mouse click on the middle of an element, so focus moves the way it does for a cashier. */
  const click = async (selectorJs) => {
    const box = await evaluate(`(() => { const el = ${selectorJs}; el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 });
    }
    await sleep(700);
  };
  const cartLines = () => evaluate(`document.querySelectorAll('section.overflow-hidden ul li').length`);
  const focusedId = () => evaluate(`document.activeElement?.id || document.activeElement?.tagName`);

  await send("Network.enable");
  await send("Network.setCookie", { name: cookieName, value: cookieRest.join("="), url: BASE });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/pos` });
  await sleep(5000);

  // 1. Scan, remove the line with a real click, scan again.
  await scan("LW265TS99035XL");
  check((await cartLines()) === 1, "LW265TS99035XL scanned into the cart");
  await click(`document.querySelector('section.overflow-hidden ul li button[aria-label]')`);
  check((await cartLines()) === 0, "the line was removed with a real click");
  await sleep(500);
  check((await focusedId()) === "pos-barcode-input", "after removing a line the barcode field has focus again", await focusedId());
  await scan("LW265TS99035XL");
  check((await cartLines()) === 1, "scanning again after a removal adds the item, no F5 needed");

  // 2. Clear the whole cart with a real click, scan again.
  await click(`[...document.querySelectorAll('section.overflow-hidden header button')].find(b => b.innerText.includes('ล้าง') || /clear/i.test(b.innerText))`);
  check((await cartLines()) === 0, "the cart was cleared with a real click");
  await sleep(500);
  check((await focusedId()) === "pos-barcode-input", "after clearing the cart the barcode field has focus again", await focusedId());
  await scan("LW265TS99035XL");
  check((await cartLines()) === 1, "scanning after Clear adds the item");

  // 3. Even if focus is lost completely (a button removed from the page), the next scan still lands.
  await evaluate(`(() => { const b = document.createElement('button'); b.id = 'tmp-focus'; b.textContent = 'x'; document.body.appendChild(b); b.focus(); b.remove(); })()`);
  check(["BODY", "pos-barcode-input"].includes(await focusedId()), "focus was knocked to the page body", await focusedId());
  await sleep(600);
  check((await focusedId()) === "pos-barcode-input", "within a moment focus is back in the barcode field by itself", await focusedId());
  await scan("LW265TS99035XL");
  check(await evaluate(`[...document.querySelectorAll('section.overflow-hidden ul li')].some(li => /\\n2\\n/.test(li.innerText))`), "the scan after lost focus raised the quantity to 2");

  // 4. A category chosen earlier does not hide the search result.
  await evaluate(`[...document.querySelectorAll('button[aria-pressed]')].find(b => b.innerText.trim().toUpperCase() === 'SKIRT' || b.innerText.includes('กระโปรง')).click()`);
  await sleep(1500);
  await evaluate(`(() => { const el = document.getElementById('pos-barcode-input'); el.focus(); })()`);
  await send("Input.insertText", { text: "990" });
  await sleep(2200);
  const found = await evaluate(`[...document.querySelectorAll('[class*=grid-cols-5] button')].some(b => b.innerText.includes('LW265TS990'))`);
  check(found, "searching 990 finds LW265TS990 even though a category was chosen first");
  const allActive = await evaluate(`[...document.querySelectorAll('button[aria-pressed=true]')].some(b => b.innerText.trim() === 'ทั้งหมด' || /^all$/i.test(b.innerText.trim()))`);
  check(allActive, "the category goes back to All when a search is typed");
  await shot("reg-search.png");

  // 5. The strip has a left arrow once it has been moved to the right.
  await evaluate(`document.getElementById('pos-barcode-input').select()`);
  await key("Backspace", "Backspace", 8);
  await sleep(1500);
  const before = await evaluate(`({ left: !!document.querySelector('button[aria-label*="earlier"], button[aria-label*="ก่อนหน้า"]'), right: !!document.querySelector('button[aria-label*="more categories"], button[aria-label*="เพิ่มเติม"]') })`);
  check(before.right && !before.left, "at the start only the right arrow shows", JSON.stringify(before));
  await click(`document.querySelector('button[aria-label*="เพิ่มเติม"], button[aria-label*="more categories"]')`);
  await sleep(900);
  const after = await evaluate(`({ left: !!document.querySelector('button[aria-label*="earlier"], button[aria-label*="ก่อนหน้า"]'), right: !!document.querySelector('button[aria-label*="more categories"], button[aria-label*="เพิ่มเติม"]') })`);
  check(after.left, "after moving right a left arrow appears", JSON.stringify(after));
  await click(`document.querySelector('button[aria-label*="earlier"], button[aria-label*="ก่อนหน้า"]')`);
  await sleep(900);
  const back = await evaluate(`document.querySelector('[role=group][aria-label]').scrollLeft`);
  check(back < 280, "the left arrow moves the strip back", `scrollLeft ${Math.round(back)}`);
  await shot("reg-strip.png");
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failures ? 1 : 0;
