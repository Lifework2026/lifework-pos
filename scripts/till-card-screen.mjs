// Walks one card sale through the till screen at 1366x768 with headless Chrome, the way the shop will do it with its own EDC
// machine: scan, press pay, choose the card channel, type the slip reference, record it, complete the sale.
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' TEST_BARCODE=LW235CP41500F node scripts/till-card-screen.mjs              stops after the slip is recorded
//   ... node scripts/till-card-screen.mjs --complete    also completes the sale: a REAL bill is saved
//
// After --complete, remove the bill with: npx tsx scripts/mock-stock.ts --clear-bills --apply. Screenshots go to exports/screens.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const COMPLETE = process.argv.includes("--complete");
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = path.resolve(process.cwd(), "exports", "screens") + "/";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333 + Math.floor(Math.random() * 500);
const BARCODE = process.env.TEST_BARCODE ?? "LW235CP41500F";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.TILL_USERNAME, password: process.env.TILL_PASSWORD }) });
if (!login.ok) throw new Error("login failed " + login.status);
const [cookieName, ...rest] = login.headers.getSetCookie()[0].split(";")[0].split("=");

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "card-"))}`, "--window-size=1366,768", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let failures = 0;
const check = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(OUT + name, Buffer.from(s.result.data, "base64")); };
  const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };
  const type = async (text) => { await send("Input.insertText", { text }); };
  const dialog = () => evaluate(`(document.querySelector('[role=dialog]')?.innerText || '').replace(/\\s+/g, ' ')`);

  await send("Network.enable");
  await send("Network.setCookie", { name: cookieName, value: rest.join("="), url: BASE });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/pos` });
  await sleep(5000);

  await type(BARCODE);
  await key("Enter", "Enter", 13);
  await sleep(1500);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.className.includes('h-14')).click()`);
  await sleep(2500);
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => /บัตรเครดิต|Credit/.test(b.innerText)).click()`);
  await sleep(1500);
  const text = await dialog();
  await shot("card-1-manual.png");
  check(/กรอกเลขจากสลิป|slip/.test(text), "the card screen tells the cashier to charge on the EDC machine and type the slip number", text.slice(0, 160));
  check(!/ส่ง .* ไปยังเครื่องรูดบัตร|Send .* to card terminal/.test(text), "there is no \"send to terminal\" button to fail");
  const confirmVisible = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.className.includes('h-12')); if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()`);
  check(confirmVisible, "the confirm button is on the screen without scrolling, even with the slip boxes open");
  check(await evaluate(`!!document.querySelector('[role=dialog] input.font-mono')`), "the slip reference box is on the screen straight away, for any role");
  const submitOff = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.className.includes('h-12')); return b ? b.disabled : null; })()`);
  check(submitOff === true, "the sale cannot be completed before the slip is recorded");

  if (COMPLETE) {
    await evaluate(`document.querySelector('[role=dialog] input.font-mono').focus()`);
    const slipRef = `SCREEN${Date.now().toString(36).toUpperCase()}`;
    await type(slipRef);
    await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => /บันทึกการชำระด้วยบัตร|Record card/.test(b.innerText)).click()`);
    await sleep(4500);
    const receipt = await dialog();
    await shot("card-2-receipt.png");
    check(/POS-\d{8}-\d{4}/.test(receipt), "recording the slip completes the sale and the receipt appears", receipt.slice(0, 100));
    check(await evaluate(`document.body.innerText.includes(${JSON.stringify(slipRef)})`), "the slip reference is printed on the receipt", slipRef);
  }
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failures ? 1 : 0;
