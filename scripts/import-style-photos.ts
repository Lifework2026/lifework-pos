// Takes the pictures out of a supplier packing-list workbook (.xlsx) and makes them the style photo of each product.
//
//   npx tsx scripts/import-style-photos.ts "LWK26-03 New.xlsx"                 preview: writes files to exports/style-photos, changes nothing
//   npx tsx scripts/import-style-photos.ts "LWK26-03 New.xlsx" --apply         uploads and saves the photos of products that have none yet
//   npx tsx scripts/import-style-photos.ts "LWK26-03 New.xlsx" --apply --replace   also replaces photos that already exist
//
// How it works: every row of the sheet carries its style's picture. The rows are grouped by PRODUCT CODE, the sharpest
// copy of each style is kept, shrunk to WebP under 150 KB (never enlarged), and matched to the product by the row
// BARCODEs, so it works whatever the product is named. The preview folder holds report.csv and preview.html: open the
// page to check the pictures (some are shots of several colours) before applying.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { planStylePhotos, decideStyle, normalizeStyle, type SheetImage, type SheetRow, type StylePick } from "../lib/catalog/style-photos";
import { compressToTarget, formatBytes } from "../lib/image-compress";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const replace = args.includes("--replace");
const outDir = path.resolve(process.cwd(), "exports", "style-photos");

if (!file) {
  console.error('Usage: npx tsx scripts/import-style-photos.ts "<workbook.xlsx>" [--apply] [--replace]');
  process.exit(2);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
  }
  return "";
}

const header = (value: ExcelJS.CellValue) => cellText(value).toUpperCase().replace(/\s+/g, " ");

interface Workbook {
  rows: SheetRow[];
  images: SheetImage[];
  buffers: Buffer[];
}

async function readWorkbook(filePath: string): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets.");

  const columns = new Map<string, number>();
  // The first column with a name wins: a sheet may repeat a header further to the right.
  ws.getRow(1).eachCell((cell, col) => {
    const name = header(cell.value);
    if (!columns.has(name)) columns.set(name, col);
  });
  const need = (name: string): number => {
    const col = columns.get(name);
    if (!col) throw new Error(`The first row has no "${name}" column. Found: ${Array.from(columns.keys()).join(", ")}`);
    return col;
  };
  const styleCol = need("PRODUCT CODE");
  const colorCol = need("COLOR CODE");
  const barcodeCol = need("BARCODE");
  const descriptionCol = columns.get("DESCRIPTION");

  const media = (wb.model as unknown as { media?: { buffer: Buffer }[] }).media ?? [];
  const buffers: Buffer[] = [];
  const images: SheetImage[] = [];
  const indexOfMedia = new Map<number, number>();
  const imageAtRow = new Map<number, number>();
  for (const placed of ws.getImages()) {
    const mediaId = Number(placed.imageId);
    if (!indexOfMedia.has(mediaId) && media[mediaId]) {
      const meta = await sharp(media[mediaId].buffer).metadata();
      indexOfMedia.set(mediaId, images.length);
      images.push({ width: meta.width ?? 0, height: meta.height ?? 0 });
      buffers.push(media[mediaId].buffer);
    }
    // nativeRow counts from 0; sheet rows from 1.
    const row = (placed.range as unknown as { tl: { nativeRow: number } }).tl.nativeRow + 1;
    const index = indexOfMedia.get(mediaId);
    if (index !== undefined && !imageAtRow.has(row)) imageAtRow.set(row, index);
  }

  const rows: SheetRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    rows.push({
      row: r,
      style: normalizeStyle(cellText(row.getCell(styleCol).value)),
      colorCode: cellText(row.getCell(colorCol).value),
      barcode: cellText(row.getCell(barcodeCol).value),
      description: descriptionCol ? cellText(row.getCell(descriptionCol).value) : "",
      image: imageAtRow.get(r) ?? null,
    });
  }
  return { rows, images, buffers };
}

interface Encoded {
  buffer: Buffer;
  width: number;
  height: number;
}

async function toWebp(source: Buffer): Promise<Encoded> {
  const meta = await sharp(source).metadata();
  const { encoded, width, height } = await compressToTarget(
    async (w, h, quality) => {
      const buffer = await sharp(source)
        .flatten({ background: "#ffffff" })
        .resize(w, h, { fit: "fill" })
        .webp({ quality: Math.round(quality * 100) })
        .toBuffer();
      return { size: buffer.length, type: "image/webp", buffer };
    },
    { width: meta.width ?? 1, height: meta.height ?? 1 },
  );
  return { buffer: encoded.buffer, width, height };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const csv = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

interface Row {
  pick: StylePick;
  webp: Encoded;
  status: string;
}

function writeReport(rows: Row[], notes: string[]): void {
  const head = ["style", "description", "colours", "sheet rows", "source px", "photo px", "photo size", "check", "status"];
  const lines = [head.map(csv).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.pick.style,
        r.pick.description,
        r.pick.colors.length,
        r.pick.rows,
        `${r.pick.width}x${r.pick.height}`,
        `${r.webp.width}x${r.webp.height}`,
        formatBytes(r.webp.buffer.length),
        r.pick.lowResolution ? "low resolution" : "",
        r.status,
      ]
        .map(csv)
        .join(","),
    );
  }
  writeFileSync(path.join(outDir, "report.csv"), `﻿${lines.join("\r\n")}\r\n`);

  const cards = rows
    .map(
      (r) => `<figure><img src="data:image/webp;base64,${r.webp.buffer.toString("base64")}" alt="${esc(r.pick.style)}"><figcaption><b>${esc(r.pick.style)}</b><br>${esc(r.pick.description)}<br>` +
        `${r.pick.colors.length} colour(s) · ${r.webp.width}×${r.webp.height} · ${formatBytes(r.webp.buffer.length)}` +
        `${r.pick.lowResolution ? '<br><span class="warn">low resolution</span>' : ""}<br><span class="st">${esc(r.status)}</span></figcaption></figure>`,
    )
    .join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>Style photos</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#fafafa}h1{font-size:18px}.notes{background:#fff7e0;padding:8px 12px;border-radius:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}
img{width:100%;height:200px;object-fit:contain;background:#fff}figcaption{font-size:12px;margin-top:6px}.warn{color:#b45309}.st{color:#555}</style>
<h1>Style photos (${rows.length})</h1>${notes.length ? `<div class="notes">${notes.map(esc).join("<br>")}</div>` : ""}<div class="grid">${cards}</div>`;
  writeFileSync(path.join(outDir, "preview.html"), html);
}

async function main(): Promise<void> {
  console.log(`Reading ${file} ...`);
  const { rows, images, buffers } = await readWorkbook(path.resolve(file as string));
  const plan = planStylePhotos(rows, images);
  console.log(`${images.length} pictures, ${plan.picks.length} styles with a picture, ${plan.withoutImage.length} without, ${plan.ignored.length} other rows ignored.`);

  mkdirSync(outDir, { recursive: true });
  const encoded = new Map<string, Encoded>();
  for (const pick of plan.picks) {
    const webp = await toWebp(buffers[pick.image]);
    encoded.set(pick.style, webp);
    writeFileSync(path.join(outDir, `${pick.style}.webp`), webp.buffer);
  }

  // Matching against the database is read-only here. If it cannot be reached the preview is still written.
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");
  const outcomes = new Map<string, ReturnType<typeof decideStyle>>();
  let dbError: string | null = null;
  try {
    const codes = plan.picks.flatMap((p) => p.barcodes);
    const variants = await prisma.productVariant.findMany({
      where: { OR: [{ barcode: { in: codes } }, { sku: { in: codes } }] },
      select: { barcode: true, sku: true, product: { select: { id: true, imageUrl: true } } },
    });
    const byCode = new Map<string, { id: string; imageUrl: string | null }>();
    for (const v of variants) {
      byCode.set(v.barcode, v.product);
      byCode.set(v.sku, v.product);
    }
    for (const pick of plan.picks) {
      const products = new Map<string, { id: string; imageUrl: string | null }>();
      for (const code of pick.barcodes) {
        const product = byCode.get(code);
        if (product) products.set(product.id, product);
      }
      outcomes.set(pick.style, decideStyle(Array.from(products.values()).map((p) => ({ productId: p.id, hasPhoto: !!p.imageUrl })), replace));
    }
  } catch (err) {
    const lines = err instanceof Error ? err.message.split("\n") : [];
    dbError = lines.find((l) => /authentication failed|can't reach|timed out|denied|not valid/i.test(l))?.trim() ?? "the database returned an error";
  }

  const statusOf = (style: string): string => {
    const o = outcomes.get(style);
    if (!o) return "database not checked";
    if (o.kind === "not-in-system") return "not in the system yet";
    if (o.kind === "skip-has-photo") return "already has a photo";
    return `will be set on ${o.productIds.length} product(s)`;
  };
  const report: Row[] = plan.picks.map((pick) => ({ pick, webp: encoded.get(pick.style) as Encoded, status: statusOf(pick.style) }));
  const notes = [
    ...(dbError ? [`The database could not be checked (${dbError}). Matching is skipped.`] : []),
    ...(plan.withoutImage.length ? [`No picture for: ${plan.withoutImage.join(", ")}`] : []),
    ...(plan.ignored.length ? [`Rows ignored (not a style code): ${plan.ignored.map((i) => `row ${i.row}`).join(", ")}`] : []),
  ];
  writeReport(report, notes);

  const count = (pred: (r: Row) => boolean) => report.filter(pred).length;
  console.log(`Wrote ${report.length} photos, report.csv and preview.html to ${outDir}`);
  console.log(`  low resolution (under 200 px): ${count((r) => r.pick.lowResolution)}`);
  console.log(`  biggest file: ${formatBytes(Math.max(0, ...report.map((r) => r.webp.buffer.length)))}`);
  if (dbError) console.log(`  database: not checked (${dbError})`);
  else {
    console.log(`  will be set: ${count((r) => outcomes.get(r.pick.style)?.kind === "set")}`);
    console.log(`  already have a photo (kept): ${count((r) => outcomes.get(r.pick.style)?.kind === "skip-has-photo")}`);
    console.log(`  not in the system yet: ${count((r) => outcomes.get(r.pick.style)?.kind === "not-in-system")}`);
  }
  for (const n of notes) console.log(`  note: ${n}`);

  if (!apply) {
    console.log("\nPreview only. Check preview.html, then run again with --apply.");
    await prisma.$disconnect();
    return;
  }
  if (dbError) throw new Error("Cannot apply: the database is not reachable.");

  const { getStorageConfig } = await import("../lib/storage");
  const { storeFor } = await import("../lib/product-image-store");
  const { replaceProductImage } = await import("../lib/product-image-binding");
  const config = getStorageConfig();
  if (!config) throw new Error("Cannot apply: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
  const store = storeFor(config);
  const db = {
    find: (id: string) => prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true, imagePath: true } }),
    save: async (id: string, image: { url: string; path: string } | null) => {
      await prisma.product.update({ where: { id }, data: { imageUrl: image?.url ?? null, imagePath: image?.path ?? null } });
    },
  };

  let done = 0;
  const failed: string[] = [];
  for (const pick of plan.picks) {
    const outcome = outcomes.get(pick.style);
    if (!outcome || outcome.kind !== "set") continue;
    const bytes = new Uint8Array((encoded.get(pick.style) as Encoded).buffer);
    for (const productId of outcome.productIds) {
      try {
        const saved = await replaceProductImage(db, store, productId, bytes, { mime: "image/webp", ext: "webp" });
        await prisma.auditLog.create({
          data: { action: "PRODUCT_IMAGE_SET", entityType: "Product", entityId: productId, details: { path: saved.path, source: "import-style-photos", style: pick.style } },
        });
        done++;
      } catch (err) {
        failed.push(`${pick.style} (${productId}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  console.log(`\nSaved ${done} product photo(s).`);
  for (const f of failed) console.log(`  FAILED ${f}`);
  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

