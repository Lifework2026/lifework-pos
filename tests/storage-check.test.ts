// The storage check: it must name the real problem (bracketed key, wrong key type, wrong project, refused upload) and never
// show the key. Run with: npx tsx tests/storage-check.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkStorage, type StorageConfig } from "../lib/storage";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const jwt = (payload: object) => `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature-part`;
const SECRET = jwt({ role: "service_role", ref: "abcdefghij" });
const config = (over: Partial<StorageConfig> = {}): StorageConfig => ({ url: "https://abcdefghij.supabase.co", key: SECRET, bucket: "product-images", ...over });

/** A storage server that answers each kind of request with the given status. */
function fakeFetch(statuses: { bucket?: number; upload?: number } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const status = method === "DELETE" ? 200 : url.includes("/storage/v1/bucket/") ? (statuses.bucket ?? 200) : (statuses.upload ?? 200);
    return new Response("{}", { status });
  }) as typeof fetch;
}
const by = (result: Awaited<ReturnType<typeof checkStorage>>, name: string) => result.steps.find((step) => step.name === name);

(async () => {
  await test("no settings: not ok, and it says which settings to add", async () => {
    const result = await checkStorage(null, fakeFetch());
    assert.equal(result.ok, false);
    assert.match(result.hint, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });

  await test("everything right: every step passes and the test file is written", async () => {
    const result = await checkStorage(config(), fakeFetch());
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((s) => [s.name, s.ok]), [["url", true], ["key", true], ["bucket", true], ["write", true]]);
    assert.match(result.hint, /Storage works/);
  });

  await test("a key pasted with square brackets or quotes is named as the problem", async () => {
    for (const key of [`[${SECRET}]`, `"${SECRET}"`, `${SECRET} `]) {
      const result = await checkStorage(config({ key }), fakeFetch({ bucket: 401, upload: 401 }));
      assert.equal(by(result, "key")?.ok, false);
      assert.match(by(result, "key")?.detail ?? "", /square bracket|quote|space/);
      assert.match(result.hint, /bracket|quote|space/, "it is the first thing to fix");
    }
  });

  await test("the anon key, a cut-off key and a key from another project are told apart", async () => {
    const anon = await checkStorage(config({ key: jwt({ role: "anon", ref: "abcdefghij" }) }), fakeFetch());
    assert.match(by(anon, "key")?.detail ?? "", /"anon" key.*service_role/);
    const cut = await checkStorage(config({ key: SECRET.slice(0, 30) }), fakeFetch());
    assert.match(by(cut, "key")?.detail ?? "", /not shaped like a Supabase key/);
    const other = await checkStorage(config({ key: jwt({ role: "service_role", ref: "zzzzzzzzzz" }) }), fakeFetch());
    assert.match(by(other, "key")?.detail ?? "", /belongs to project zzzzzzzzzz.*abcdefghij\.supabase\.co/);
  });

  await test("a URL with a path, or without https, is named", async () => {
    assert.equal(by(await checkStorage(config({ url: "https://abcdefghij.supabase.co/storage/v1" }), fakeFetch()), "url")?.ok, false);
    assert.equal(by(await checkStorage(config({ url: "http://abcdefghij.supabase.co" }), fakeFetch()), "url")?.ok, false);
    assert.match(by(await checkStorage(config({ url: "not a url" }), fakeFetch()), "url")?.detail ?? "", /not a valid address/);
  });

  await test("a refused upload or a refused bucket shows the HTTP status", async () => {
    const refused = await checkStorage(config(), fakeFetch({ upload: 403 }));
    assert.match(by(refused, "write")?.detail ?? "", /HTTP 403/);
    const noBucket = await checkStorage(config(), fakeFetch({ bucket: 401 }));
    assert.match(by(noBucket, "bucket")?.detail ?? "", /refused the key \(HTTP 401\)/);
    const missing = await checkStorage(config(), fakeFetch({ bucket: 404 }));
    assert.match(by(missing, "bucket")?.detail ?? "", /was not found/);
  });

  await test("storage that cannot be reached is reported, not thrown", async () => {
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const result = await checkStorage(config(), down);
    assert.equal(result.ok, false);
    assert.match(by(result, "write")?.detail ?? "", /could not be reached/);
  });

  await test("the answer never contains the key", async () => {
    for (const key of [SECRET, `[${SECRET}]`]) {
      const text = JSON.stringify(await checkStorage(config({ key }), fakeFetch({ bucket: 401, upload: 401 })));
      assert.ok(!text.includes(SECRET) && !text.includes("signature-part"));
    }
  });

  await test("route and messages: a manager-only check, and a failed save says what storage replied and where to look", () => {
    const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");
    const route = read("app/api/admin/storage-check/route.ts");
    assert.ok(route.includes("await requireManager()") && route.includes("export async function GET") && !route.includes("POST"));
    for (const file of ["lib/product-image-store.ts", "app/api/admin/uploads/product-image/route.ts"]) {
      assert.ok(read(file).includes("${err.message}") && read(file).includes("/api/admin/storage-check"), file);
    }
    assert.ok(read("components/admin/photo-cutter.tsx").includes("/api/admin/storage-check"), "the photo cutter links to it");
  });

  console.log(`\n${passed} storage-check tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
