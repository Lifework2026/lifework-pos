// How the card terminal is used. Run with: npx tsx tests/edc-mode.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveEdcMode } from "../lib/edc/mode";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}
const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("manual and standalone mean the shop's own EDC machine with a slip reference", () => {
  assert.equal(resolveEdcMode({ EDC_MODE: "manual", NODE_ENV: "production" }), "manual");
  assert.equal(resolveEdcMode({ EDC_MODE: " Standalone ", NODE_ENV: "production" }), "manual");
});

test("nothing set, or a typo, is manual: the till then asks for a slip and cannot invent an approval", () => {
  assert.equal(resolveEdcMode({ NODE_ENV: "production" }), "manual");
  assert.equal(resolveEdcMode({ EDC_MODE: "brigde", NODE_ENV: "production" }), "manual");
  assert.equal(resolveEdcMode({ EDC_MODE: "", NODE_ENV: "development" }), "manual");
});

test("the simulator only runs outside production; in production it is manual, never a fake approval", () => {
  assert.equal(resolveEdcMode({ EDC_MODE: "simulator", NODE_ENV: "development" }), "simulator");
  assert.equal(resolveEdcMode({ EDC_MODE: "simulator", NODE_ENV: "test" }), "simulator");
  assert.equal(resolveEdcMode({ EDC_MODE: "simulator", NODE_ENV: "production" }), "manual");
});

const bridgeSettings = { EDC_BRIDGE_URL: "https://bridge.example", EDC_BRIDGE_TOKEN: "t", EDC_WEBHOOK_SECRET: "s" };

test("bridge stays bridge when its address, token and webhook secret are all set", () => {
  assert.equal(resolveEdcMode({ EDC_MODE: "bridge", NODE_ENV: "production", ...bridgeSettings }), "bridge");
});

test("bridge with any setting missing cannot work, so the till takes slip references instead of showing an error", () => {
  assert.equal(resolveEdcMode({ EDC_MODE: "bridge", NODE_ENV: "production" }), "manual");
  assert.equal(resolveEdcMode({ EDC_MODE: "bridge", NODE_ENV: "production", ...bridgeSettings, EDC_BRIDGE_URL: "" }), "manual");
  assert.equal(resolveEdcMode({ EDC_MODE: "bridge", NODE_ENV: "production", ...bridgeSettings, EDC_WEBHOOK_SECRET: "  " }), "manual");
});

test("the service refuses to start a terminal payment in manual mode, with a message that says what to do", () => {
  const service = read("lib/edc/service.ts");
  assert.ok(service.includes("resolveEdcMode(process.env)") && service.includes('"EDC_MANUAL_MODE"'));
  assert.ok(!service.includes("The EDC simulator cannot run in production"), "no more plain 500 error in production");
});

test("the mode route needs a signed-in user and the env check accepts manual and standalone", () => {
  const route = read("app/api/edc/mode/route.ts");
  assert.ok(route.includes("getCurrentSession()") && route.includes("resolveEdcMode(process.env)"));
  const check = read("scripts/check-env.mjs");
  assert.ok(check.includes('"manual", "standalone", "simulator", "bridge"'));
});

console.log(`\n${passed} edc-mode tests passed`);
