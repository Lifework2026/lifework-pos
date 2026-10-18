// Real-browser check of the back office Photo cutter (Admin > Photo cutter): choose a product page picture, see the boxes it
// finds, pick a colour for each, and (with --save) save them on the style.
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' node scripts/till-photo-cutter.mjs "D:/packshot lifework/LW252DL229_.jpg"
//   ... --save    also saves the cut photos on the colours (a real change: it uploads and replaces those colour photos)
//
// The colours are chosen by name from the option list, in the order the boxes are found: --colours "Black,Indigo".

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const file = path.resolve(args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--colours") ?? "");
const save = args.includes("--save");
const colourNames = (args[args.indexOf("--colours") + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve(process.cwd(), "exports", "screens");
const PORT = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.TILL_USERNAME || !process.env.TILL_PASSWORD || !file) {
  console.error('Set TILL_USERNAME and TILL_PASSWORD and give a picture: node scripts/till-photo-cutter.mjs "<picture>"');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.TILL_USERNAME, password: process.env.TILL_PASSWORD }) });
if (!login.ok) throw new Error("login failed " + login.status);
const [cookieName, ...cookieRest] = login.headers.getSetCookie()[0].split(";")[0].split("=");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "cut-"))}`, "--window-size=1366,900", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });

let failures = 0;
const check = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
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
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, name), Buffer.from(s.result.data, "base64")); };

  await send("Network.enable");
  await send("Network.setCookie", { name: cookieName, value: cookieRest.join("="), url: BASE });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/admin/photo-cutter` });
  await sleep(4500);
  await send("DOM.enable");
  const doc = await send("DOM.getDocument");
  const input = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: 'input[type="file"]' });
  await send("DOM.setFileInputFiles", { nodeId: input.result.nodeId, files: [file] });
  await sleep(3500);

  const state = JSON.parse(await evaluate(`JSON.stringify({ style: document.querySelector('input.num')?.value, boxes: document.querySelectorAll('select').length, options: [...(document.querySelector('select')?.options ?? [])].map(o => o.text.trim()) })`));
  check(!!state.style, "the style code was read from the file name", state.style);
  check(state.boxes >= 1, "boxes were found around the colour photos", `${state.boxes}`);
  check(state.options.length > 1, "the colour list holds the colours of the style", state.options.join(" | "));
  await shot("cutter-1-found.png");

  if (colourNames.length > 0) {
    for (let i = 0; i < colourNames.length; i++) {
      const picked = await evaluate(`(() => { const select = document.querySelectorAll('select')[${i}]; if (!select) return false; const option = [...select.options].find(o => o.text.trim().toLowerCase().startsWith(${JSON.stringify(colourNames[i].toLowerCase())})); if (!option) return false; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(select, option.value); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      check(picked, `box ${i + 1} set to ${colourNames[i]}`);
    }
    await sleep(500);
    await shot("cutter-2-chosen.png");
    const saveState = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => /บันทึก \\d+ รูป|Save \\d+ photo/.test(x.innerText)); return b ? { text: b.innerText.trim(), disabled: b.disabled } : null; })()`);
    check(!!saveState && !saveState.disabled, "the save button is ready", saveState?.text ?? "missing");
    if (save && saveState && !saveState.disabled) {
      await evaluate(`[...document.querySelectorAll('button')].find(x => /บันทึก \\d+ รูป|Save \\d+ photo/.test(x.innerText)).click()`);
      await sleep(9000);
      const done = await evaluate(`[...document.querySelectorAll('p')].filter(p => /บันทึกแล้ว|^Saved$/.test(p.innerText.trim())).length`);
      check(done === colourNames.length, "every box says it was saved", `${done} of ${colourNames.length}`);
      await shot("cutter-3-saved.png");
    }
  }
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failures ? 1 : 0;
