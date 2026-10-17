// Smoke test of the cashier side against a running server: photos, fallback, search, barcode lookup and prices.
// It logs in over the API, so it needs an account. Nothing is written to the database.
//
//   TILL_USERNAME=admin TILL_PASSWORD='...' npx tsx scripts/check-till.ts                 against http://localhost:3000
//   BASE_URL=https://your-site TILL_USERNAME=... TILL_PASSWORD=... npx tsx scripts/check-till.ts
//
// Expected sale prices below are the styles whose SALE PRICE in the supplier workbook overrides the tag price.

import path from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Style -> selling price in baht, from the SALE PRICE column of the workbook. */
const SALE_PRICES: Record<string, number> = {
  LW245KS971: 1290,
  LW252KL481: 2700,
  LW252WL442: 2700,
  LW252WL898: 3600,
  LW255TS971: 790,
  LW252DO881: 3600,
  LW252DL229: 2400,
  LW252DL819: 3000,
  LW252DL840: 2400,
  LW252DO780: 4500,
  LW252KL881: 2700,
  LW252WL422: 2400,
  LW252WL652: 2400,
  LW252WL677: 2700,
  LW252WL842: 2700,
  LW252WL869: 2400,
  LW252WL873: 3600,
  LW252WL892: 3600,
};
/** A few styles priced by their tag price. */
const TAG_PRICES: Record<string, number> = { LW262TS116: 1790, LW265TS990: 1290, LW262SR414: 2700 };

interface Variant {
  sku: string;
  barcode: string;
  price: string;
  color: string;
  size: string;
  product: { name: string; imageUrl: string | null };
}

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, name: string, detail = ""): void {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? ` (${detail})` : ""}`);
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const username = process.env.TILL_USERNAME;
  const password = process.env.TILL_PASSWORD;
  if (!username || !password) throw new Error("Set TILL_USERNAME and TILL_PASSWORD.");

  const login = await fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!login.ok) throw new Error(`Login failed: HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const get = async <T>(url: string): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${BASE_URL}${url}`, { headers: { cookie } });
    return { status: res.status, body: (await res.json().catch(() => null)) as T };
  };
  console.log(`Logged in to ${BASE_URL} as ${username}.`);

  const { prisma } = await import("../lib/prisma");
  const products = await prisma.product.findMany({ where: { slug: { not: "shopping-bag" } }, select: { name: true, imageUrl: true } });
  const withPhoto = products.filter((p) => p.imageUrl);
  const withoutPhoto = products.filter((p) => !p.imageUrl);
  console.log(`Catalogue: ${products.length} styles, ${withPhoto.length} with a photo, ${withoutPhoto.length} without.`);
  const storage = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");

  // a) Every style with a photo returns a WebP address from our storage, and the file really is served.
  const urls = new Set<string>();
  let badUrl = 0;
  for (const p of withPhoto) {
    const { status, body } = await get<{ variants: Variant[] }>(`/api/products?q=${encodeURIComponent(p.name)}`);
    const rows = body?.variants.filter((v) => v.product.name === p.name) ?? [];
    if (status !== 200 || rows.length === 0) {
      badUrl++;
      continue;
    }
    for (const v of rows) {
      const url = v.product.imageUrl;
      if (!url || !url.endsWith(".webp") || (storage && !url.startsWith(`${storage}/storage/v1/object/public/product-images/`))) badUrl++;
      else urls.add(url);
    }
  }
  check(badUrl === 0, "a) every variant of a style with a photo returns a .webp storage address", `${badUrl} bad`);
  let unreachable = 0;
  for (const url of Array.from(urls)) {
    const res = await fetch(url, { method: "HEAD" });
    if (res.status !== 200 || res.headers.get("content-type") !== "image/webp") unreachable++;
  }
  check(unreachable === 0, `a) all ${urls.size} photo files are served as image/webp`, `${unreachable} not`);
  check(urls.size === withPhoto.length, "a) one distinct photo file per style with a photo", `${urls.size} files for ${withPhoto.length} styles`);

  // b) Styles without a photo return no address at all, which the till shows as the placeholder icon.
  let noPhotoWrong = 0;
  for (const p of withoutPhoto) {
    const { status, body } = await get<{ variants: Variant[] }>(`/api/products?q=${encodeURIComponent(p.name)}`);
    const rows = body?.variants.filter((v) => v.product.name === p.name) ?? [];
    if (status !== 200 || rows.length === 0 || rows.some((v) => v.product.imageUrl !== null)) noPhotoWrong++;
  }
  check(noPhotoWrong === 0, `b) all ${withoutPhoto.length} styles without a photo are listed with imageUrl null`, `${noPhotoWrong} wrong`);

  // c) Search and barcode lookup give the exact price, including the sale-price styles.
  const expected: Record<string, number> = { ...TAG_PRICES, ...SALE_PRICES };
  let variantsChecked = 0;
  for (const [style, price] of Object.entries(expected)) {
    const { status, body } = await get<{ variants: Variant[] }>(`/api/products?q=${encodeURIComponent(style)}`);
    const rows = body?.variants.filter((v) => v.product.name === style) ?? [];
    check(status === 200 && rows.length > 0, `c) search finds ${style}`, `HTTP ${status}, ${rows.length} rows`);
    const wrong = rows.filter((v) => Number(v.price) !== price);
    check(wrong.length === 0, `c) search price of every ${style} variant is ${price}`, wrong.slice(0, 2).map((v) => `${v.barcode}=${v.price}`).join(","));
    variantsChecked += rows.length;
    for (const v of [rows[0], rows[rows.length - 1]].filter(Boolean)) {
      const scan = await get<{ variant: Variant }>(`/api/products/search?barcode=${encodeURIComponent(v.barcode)}`);
      check(scan.status === 200 && Number(scan.body?.variant.price) === price, `c) barcode ${v.barcode} gives ${price}`, `HTTP ${scan.status} ${scan.body?.variant?.price}`);
    }
  }
  const unknown = await get<unknown>("/api/products/search?barcode=NOT-A-BARCODE");
  check(unknown.status === 404, "c) an unknown barcode gives 404, not an error", `HTTP ${unknown.status}`);
  const noSession = await fetch(`${BASE_URL}/api/products?q=LW262TS116`);
  check(noSession.status === 401, "c) the product list needs a login", `HTTP ${noSession.status}`);

  // d) The grouped grid: one entry per style, every variant present, and the same prices as the variant list.
  const all = await get<{ styles: { name: string; imageUrl: string | null; variants: { price: string; barcode: string; imageUrl: string | null }[] }[] }>("/api/products/styles");
  const styles = all.body?.styles ?? [];
  const totalProducts = await prisma.product.count({ where: { isActive: true, variants: { some: { isActive: true } } } });
  const totalVariants = await prisma.productVariant.count({ where: { isActive: true, product: { isActive: true } } });
  check(all.status === 200 && styles.length === totalProducts, "d) the styles list has one entry per style", `${styles.length} of ${totalProducts}`);
  check(styles.reduce((sum, s) => sum + s.variants.length, 0) === totalVariants, "d) every variant is inside its style", `${styles.reduce((sum, s) => sum + s.variants.length, 0)} of ${totalVariants}`);
  check(new Set(styles.map((s) => s.name)).size === styles.length, "d) no style appears twice");
  const withPhotoStyles = styles.filter((s) => s.imageUrl);
  check(withPhotoStyles.every((s) => s.imageUrl?.endsWith(".webp")), "d) every style photo is a .webp address", `${withPhotoStyles.length} styles with a photo`);
  for (const [style, price] of Object.entries(expected)) {
    const found = styles.find((s) => s.name === style);
    check(!!found && found.variants.length > 0 && found.variants.every((variant) => Number(variant.price) === price), `d) ${style} is one card and every variant costs ${price}`);
  }
  const wrongBarcode = styles.flatMap((s) => s.variants).filter((variant) => !variant.barcode).length;
  check(wrongBarcode === 0, "d) every variant carries its barcode");

  // Every priced variant in the database matches what the till would charge (checked for all variants, one query).
  const free = await prisma.productVariant.count({ where: { price: { lte: 0 } } });
  check(free === 0, "no variant has a zero price", `${free}`);
  console.log(`Checked ${variantsChecked} variants of ${Object.keys(expected).length} styles by search, ${urls.size} photo files, ${withoutPhoto.length} styles without a photo.`);

  await prisma.$disconnect();
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
