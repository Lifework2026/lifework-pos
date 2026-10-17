// One pass from the supplier workbook to a sellable till: prices, products, variants and style photos.
//
//   npx tsx scripts/import-pos-workbook.ts "<workbook.xlsx>" --csv exports/packing-template-A-final-v3.csv           preview, changes nothing
//   npx tsx scripts/import-pos-workbook.ts "<workbook.xlsx>" --csv exports/packing-template-A-final-v3.csv --apply   imports, then uploads photos
//
// Where things come from:
//   variants   the packing-list CSV (barcode, colour, size), which already passed the importer's checks
//   prices     the workbook: a SALE PRICE wins over a TAG PRICE (THB). Sources: the product list tab (both tables) and
//              tabs 1, 3 and the new-arrivals tab. Two sources that disagree leave the style without a price.
//   photos     every picture in tabs 1, 2, 3 and the product list tab; each style gets its sharpest copy, as WebP under 150 KB
// Rows with no price are not imported; they are written to exports/packing-awaiting-price.csv. Existing products are updated
// (price only matters here), never duplicated, and photos already on a product are kept unless --replace-photos is given.
// The import is one all-or-nothing transaction. Photos upload after it, one product at a time, and can be repeated safely.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { fillPricesByStyle, resolveStylePrices, splitByPrice, splitTableByStyle, type PriceEntry } from "../lib/catalog/packing-import";
import { MAX_IMPORT_ROWS, parseImportTable, type ImportIssue, type ImportRow } from "../lib/catalog/import";
import { decideStyle, normalizeStyle, planStylePhotos, STYLE_CODE, type SheetImage, type SheetRow } from "../lib/catalog/style-photos";
import { toWebp, writePhotoReview, type EncodedPhoto, type PreviewCard } from "../lib/catalog/style-photo-files";
import { parseCsv } from "../lib/tabular";

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const workbookPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--csv");
const csvPath = flagValue("--csv");
const apply = args.includes("--apply");
const replacePhotos = args.includes("--replace-photos");
const photoDir = path.resolve(process.cwd(), "exports", "pos-workbook-photos");

if (!workbookPath || !csvPath) {
  console.error('Usage: npx tsx scripts/import-pos-workbook.ts "<workbook.xlsx>" --csv <packing.csv> [--apply] [--replace-photos]');
  process.exit(2);
}

// The layout of this workbook. Header text is compared ignoring case, spaces and punctuation; "occurrence" picks the
// second table of a tab that has two side by side.
interface Col {
  header: string;
  occurrence?: number;
}
const PRICE_SOURCES: { sheet: string; headerRow: number; firstRow: number; style: Col; tag?: Col; sale?: Col }[] = [
  { sheet: "รวมสินค้า", headerRow: 4, firstRow: 5, style: { header: "STYLE NO." }, tag: { header: "TAG PRICE (THAI, THB)" }, sale: { header: "SALE PRICE (THAI, THB)" } },
  {
    sheet: "รวมสินค้า",
    headerRow: 4,
    firstRow: 5,
    style: { header: "STYLE NO.", occurrence: 2 },
    tag: { header: "TAG PRICE (THAI, THB)", occurrence: 2 },
    sale: { header: "SALE PRICE (THAI, THB)", occurrence: 2 },
  },
  { sheet: "3", headerRow: 1, firstRow: 2, style: { header: "PRODUCT CODE" }, tag: { header: "TAG PRICE (THB)" } },
  { sheet: "ของไหม่ล่าสุด", headerRow: 1, firstRow: 2, style: { header: "Product Code" }, tag: { header: "PRICE (THB)" } },
  { sheet: "1", headerRow: 1, firstRow: 2, style: { header: "PRODUCT CODE" }, tag: { header: "TAG PRICE (THB)" } },
];
const IMAGE_SOURCES: { sheet: string; headerRow: number; style: Col }[] = [
  { sheet: "1", headerRow: 1, style: { header: "PRODUCT CODE" } },
  { sheet: "2", headerRow: 1, style: { header: "SKU" } },
  { sheet: "3", headerRow: 1, style: { header: "PRODUCT CODE" } },
  { sheet: "รวมสินค้า", headerRow: 4, style: { header: "STYLE NO." } },
];

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
  }
  return "";
}

const normalizeHeader = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function findColumn(ws: ExcelJS.Worksheet, headerRow: number, col: Col): number {
  const wanted = normalizeHeader(col.header);
  let seen = 0;
  const row = ws.getRow(headerRow);
  for (let c = 1; c <= ws.columnCount; c++) {
    if (normalizeHeader(cellText(row.getCell(c).value)) === wanted && ++seen === (col.occurrence ?? 1)) return c;
  }
  throw new Error(`Tab "${ws.name}" row ${headerRow} has no column "${col.header}"${col.occurrence ? ` (number ${col.occurrence})` : ""}.`);
}

function sheetOf(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`The workbook has no tab named "${name}". Tabs: ${wb.worksheets.map((w) => w.name).join(", ")}`);
  return ws;
}

function baht(value: string): number | null {
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return value && Number.isFinite(n) && n > 0 ? n : null;
}

function readPrices(wb: ExcelJS.Workbook): PriceEntry[] {
  const entries: PriceEntry[] = [];
  for (const src of PRICE_SOURCES) {
    const ws = sheetOf(wb, src.sheet);
    const styleCol = findColumn(ws, src.headerRow, src.style);
    const tagCol = src.tag ? findColumn(ws, src.headerRow, src.tag) : 0;
    const saleCol = src.sale ? findColumn(ws, src.headerRow, src.sale) : 0;
    const label = `${src.sheet}${src.style.occurrence ? " (right table)" : ""}`;
    for (let r = src.firstRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const style = normalizeStyle(cellText(row.getCell(styleCol).value));
      if (!STYLE_CODE.test(style)) continue;
      const tag = tagCol ? baht(cellText(row.getCell(tagCol).value)) : null;
      const sale = saleCol ? baht(cellText(row.getCell(saleCol).value)) : null;
      if (tag) entries.push({ style, kind: "tag", price: tag, source: label });
      if (sale) entries.push({ style, kind: "sale", price: sale, source: label });
    }
  }
  return entries;
}

async function readImages(wb: ExcelJS.Workbook): Promise<{ rows: SheetRow[]; images: SheetImage[]; buffers: Buffer[] }> {
  const media = (wb.model as unknown as { media?: { buffer: Buffer }[] }).media ?? [];
  const images: SheetImage[] = [];
  const buffers: Buffer[] = [];
  const indexOfMedia = new Map<number, number>();
  const rows: SheetRow[] = [];
  for (const src of IMAGE_SOURCES) {
    const ws = sheetOf(wb, src.sheet);
    const styleCol = findColumn(ws, src.headerRow, src.style);
    const seenRows = new Set<number>();
    for (const placed of ws.getImages()) {
      const mediaId = Number(placed.imageId);
      if (!media[mediaId]) continue;
      const row = (placed.range as unknown as { tl: { nativeRow: number } }).tl.nativeRow + 1;
      if (seenRows.has(row)) continue;
      seenRows.add(row);
      const style = normalizeStyle(cellText(ws.getRow(row).getCell(styleCol).value));
      if (!STYLE_CODE.test(style)) continue;
      if (!indexOfMedia.has(mediaId)) {
        const meta = await sharp(media[mediaId].buffer).metadata();
        indexOfMedia.set(mediaId, images.length);
        images.push({ width: meta.width ?? 0, height: meta.height ?? 0 });
        buffers.push(media[mediaId].buffer);
      }
      rows.push({ row, style, colorCode: "", barcode: "", description: src.sheet, image: indexOfMedia.get(mediaId) ?? null });
    }
  }
  return { rows, images, buffers };
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");
  const { Prisma } = await import("@prisma/client");
  const { planImport, commitImport } = await import("../lib/catalog/import");

  console.log(`Reading ${path.basename(workbookPath as string)} ...`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(workbookPath as string));

  // 1. Prices
  const resolved = resolveStylePrices(readPrices(wb));
  console.log(`Prices: ${resolved.prices.size} styles priced (${resolved.sale.length} from a sale price), ${resolved.conflicts.length} in conflict.`);
  for (const c of resolved.conflicts) console.log(`  CONFLICT ${c.style}: ${c.values.join(" / ")} (${c.sources.join(", ")}). Left without a price.`);

  // 2. Rows to import: the packing list with prices filled, rows with no price set aside.
  let table = parseCsv(readFileSync(path.resolve(csvPath as string), "utf8").replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), ""));
  console.log(`${path.basename(csvPath as string)}: ${table.length - 1} rows`);
  const fill = fillPricesByStyle(table, resolved.prices);
  const split = splitByPrice(fill.table);
  table = split.priced;
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const quote = (cell: string) => (/[",]/.test(cell) || cell.includes(CR) || cell.includes(LF) ? '"' + cell.split('"').join('""') + '"' : cell);
  const waiting = path.resolve(process.cwd(), "exports", "packing-awaiting-price.csv");
  mkdirSync(path.dirname(waiting), { recursive: true });
  writeFileSync(waiting, String.fromCharCode(0xfeff) + split.unpriced.map((r) => r.map(quote).join(",")).join(CR + LF) + CR + LF);
  console.log(`  priced: ${split.priced.length - 1} rows; waiting for a price: ${split.unpriced.length - 1} rows of ${split.unpricedStyles.length} styles (${waiting})`);
  console.log(`  price list styles the CSV does not have: ${fill.unused.length}`);

  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  let offset = 0;
  for (const piece of splitTableByStyle(table, MAX_IMPORT_ROWS)) {
    const parsed = parseImportTable(piece);
    for (const row of parsed.rows) rows.push({ ...row, line: row.line + offset });
    for (const issue of parsed.issues) issues.push({ ...issue, line: issue.line + offset });
    offset += piece.length - 1;
  }
  if (issues.length) {
    console.log(`The file has ${issues.length} problem(s):`);
    for (const i of issues.slice(0, 30)) console.log(`  line ${i.line}: ${i.message}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  // 3. Plan the import. Existing SKUs are updated, so a sale price reaches products that are already in.
  const options = { onExisting: "update", applyStock: false } as const;
  const plan = await planImport(prisma, rows, options);
  console.log("Import plan:", JSON.stringify(plan.summary));
  if (plan.sizes.length) console.log(`  new sizes that will be created: ${plan.sizes.join(", ")}`);
  const changed = plan.updates.filter((u) => u.priceBeforeSatang !== u.priceAfterSatang);
  const changedStyles = new Map<string, string>();
  const nameBySku = new Map(rows.map((r) => [r.sku, r.name]));
  for (const u of changed) changedStyles.set(nameBySku.get(u.sku) ?? u.sku, `${u.priceBeforeSatang / 100} -> ${u.priceAfterSatang / 100}`);
  console.log(`  existing variants whose price changes: ${changed.length} (styles: ${Array.from(changedStyles.entries()).map(([s, c]) => `${s} ${c}`).join(", ") || "none"})`);
  if (plan.issues.length) {
    console.log(`The plan has ${plan.issues.length} problem(s):`);
    for (const i of plan.issues.slice(0, 30)) console.log(`  line ${i.line}: ${i.message}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  // 4. Photos: the sharpest picture of every style that is being imported.
  const importing = new Set(rows.map((r) => normalizeStyle(r.name)));
  const sheet = await readImages(wb);
  const photoPlan = planStylePhotos(sheet.rows, sheet.images);
  const picks = photoPlan.picks.filter((p) => importing.has(p.style));
  const noPhoto = Array.from(importing).filter((s) => !picks.some((p) => p.style === s));
  console.log(`Photos: ${sheet.images.length} pictures read, ${picks.length} of ${importing.size} styles have one, ${noPhoto.length} have none.`);
  const encoded = new Map<string, EncodedPhoto>();
  for (const pick of picks) encoded.set(pick.style, await toWebp(sheet.buffers[pick.image]));
  const cards: PreviewCard[] = picks.map((p) => ({
    style: p.style,
    description: "",
    colors: 0,
    sourcePx: `${p.width}x${p.height}`,
    lowResolution: p.lowResolution,
    status: "ready",
    photo: encoded.get(p.style) as EncodedPhoto,
  }));
  writePhotoReview(photoDir, cards, noPhoto.length ? [`No picture for ${noPhoto.length} style(s): ${noPhoto.slice(0, 40).join(", ")}`] : []);
  console.log(`  low resolution (under 200 px): ${picks.filter((p) => p.lowResolution).length}; biggest file ${Math.max(0, ...Array.from(encoded.values()).map((e) => e.buffer.length))} bytes; review: ${photoDir}`);

  if (!apply) {
    console.log("\nPreview only. Check the numbers and the preview page, then run again with --apply.");
    await prisma.$disconnect();
    return;
  }

  // 5. Import, all or nothing.
  const admin = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "MANAGER"] }, isActive: true }, select: { id: true } });
  if (!admin) throw new Error("No active admin or manager account to record the import against.");
  const expectedNew = plan.summary.newVariants;
  const summary = await prisma.$transaction(
    async (tx) => {
      const again = await planImport(tx, rows, options);
      if (again.issues.length) throw new Error(`The data changed while importing: ${again.issues[0].message}`);
      if (again.summary.newVariants !== expectedNew) throw new Error("The catalogue changed after the check. Nothing was imported.");
      await commitImport(tx, again, admin.id, path.basename(csvPath as string));
      return again.summary;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 280_000 },
  );
  console.log("Imported:", JSON.stringify(summary));

  // 6. Photos, one product at a time. Each upload has its own rollback, so a failure leaves nothing half done.
  const { getStorageConfig } = await import("../lib/storage");
  const { storeFor } = await import("../lib/product-image-store");
  const { replaceProductImage } = await import("../lib/product-image-binding");
  const config = getStorageConfig();
  if (!config) throw new Error("The products are imported, but photos cannot upload: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
  const store = storeFor(config);
  const db = {
    find: (id: string) => prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true, imagePath: true } }),
    save: async (id: string, image: { url: string; path: string } | null) => {
      await prisma.product.update({ where: { id }, data: { imageUrl: image?.url ?? null, imagePath: image?.path ?? null } });
    },
  };
  const products = await prisma.product.findMany({ where: { name: { in: picks.map((p) => p.style) } }, select: { id: true, name: true, imageUrl: true } });
  const byName = new Map<string, { id: string; imageUrl: string | null }[]>();
  for (const p of products) byName.set(p.name, [...(byName.get(p.name) ?? []), { id: p.id, imageUrl: p.imageUrl }]);

  let saved = 0;
  let kept = 0;
  const failed: string[] = [];
  for (const pick of picks) {
    const outcome = decideStyle((byName.get(pick.style) ?? []).map((p) => ({ productId: p.id, hasPhoto: !!p.imageUrl })), replacePhotos);
    if (outcome.kind === "skip-has-photo") kept++;
    if (outcome.kind !== "set") continue;
    const bytes = new Uint8Array((encoded.get(pick.style) as EncodedPhoto).buffer);
    for (const productId of outcome.productIds) {
      try {
        const stored = await replaceProductImage(db, store, productId, bytes, { mime: "image/webp", ext: "webp" });
        await prisma.auditLog.create({
          data: { action: "PRODUCT_IMAGE_SET", entityType: "Product", entityId: productId, details: { path: stored.path, source: "import-pos-workbook", style: pick.style } },
        });
        saved++;
      } catch (err) {
        failed.push(`${pick.style}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  console.log(`Photos saved: ${saved}; kept (product already had one): ${kept}; failed: ${failed.length}`);
  for (const f of failed.slice(0, 20)) console.log(`  FAILED ${f}`);

  const [productCount, variantCount, priced, withPhoto] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.productVariant.count({ where: { price: { gt: 0 } } }),
    prisma.product.count({ where: { imageUrl: { not: null } } }),
  ]);
  console.log(`Now in the database: ${productCount} products, ${variantCount} variants (${priced} priced), ${withPhoto} products with a photo.`);
  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
