// Puts a folder of photos on the products. Preview by default.
//
//   npx tsx scripts/import-photo-folder.ts "D:/packshot lifework"                  preview: matches the files, saves nothing
//   npx tsx scripts/import-photo-folder.ts "D:/packshot lifework" --apply          uploads and saves the photos
//   npx tsx scripts/import-photo-folder.ts "D:/packshot lifework" --apply --replace    also replaces photos that already exist
//
// File names say where a photo goes:
//   LW252AN872_01.png   colour 01 of style LW252AN872 (the colour may be its code or its name: LW252AN872_Off White.png)
//   LW252AN872.jpg      the main photo of the style, shown for colours that have none of their own
// Each picture is shrunk to WebP, at most 800 px and under 150 KB, and never enlarged. A file that cannot be matched with
// certainty is listed and skipped. Photos that already exist are kept unless --replace is given. Open
// exports/photo-folder-review/preview.html to look at the result before applying.

import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { planPhotoFolder, type ColourOption, type PlannedPhoto, type ProductInfo } from "../lib/catalog/photo-files";
import { toWebp, writePhotoReview, type EncodedPhoto, type PreviewCard } from "../lib/catalog/style-photo-files";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const replace = args.includes("--replace");
const reviewDir = path.resolve(process.cwd(), "exports", "photo-folder-review");
/** A picture whose long side is under this many pixels will look soft when the till shows it large. */
const SOFT_BELOW_PX = 500;

if (!folder) {
  console.error('Usage: npx tsx scripts/import-photo-folder.ts "<folder>" [--apply] [--replace]');
  process.exit(2);
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");

  const dir = path.resolve(folder as string);
  const files = readdirSync(dir).sort();
  console.log(`${dir}: ${files.length} file(s)`);

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      imageUrl: true,
      variants: { select: { colorId: true, colorRef: { select: { code: true, name: true, nameTh: true } } } },
      colorImages: { select: { colorId: true } },
    },
  });
  const infos: ProductInfo[] = products.map((product) => {
    const colours = new Map<string, ColourOption>();
    for (const variant of product.variants) {
      colours.set(variant.colorId, { colorId: variant.colorId, code: variant.colorRef.code, name: variant.colorRef.name, nameTh: variant.colorRef.nameTh });
    }
    return { id: product.id, name: product.name, hasPhoto: !!product.imageUrl, colours: Array.from(colours.values()), colourPhotos: new Set(product.colorImages.map((c) => c.colorId)) };
  });

  const plan = planPhotoFolder(files, infos);
  const encoded = new Map<string, EncodedPhoto & { sourcePx: string; soft: boolean }>();
  for (const item of plan.items) {
    if (!item.target) continue;
    const source = readFileSync(path.join(dir, item.file));
    const meta = await sharp(source).metadata();
    const photo = await toWebp(source);
    const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
    encoded.set(item.file, { ...photo, sourcePx: `${meta.width}x${meta.height}`, soft: longSide < SOFT_BELOW_PX });
  }

  const status = (item: PlannedPhoto): string => {
    if (item.problem) return `SKIPPED: ${item.problem}`;
    const where = item.target?.kind === "colour" ? `colour ${item.target.label}` : "the style";
    if (item.hasPhoto && !replace) return `kept: ${where} already has a photo (use --replace)`;
    return `${item.hasPhoto ? "replaces" : "sets"} the photo of ${where}`;
  };
  console.log("");
  for (const item of plan.items) console.log(`  ${item.file.padEnd(28)} ${status(item)}`);
  for (const file of plan.ignored) console.log(`  ${file.padEnd(28)} ignored (not a picture)`);

  const cards: PreviewCard[] = plan.items
    .filter((item) => item.target && encoded.has(item.file))
    .map((item) => {
      const photo = encoded.get(item.file) as EncodedPhoto & { sourcePx: string; soft: boolean };
      return {
        style: path.basename(item.file, path.extname(item.file)),
        description: item.target?.kind === "colour" ? item.target.label : "style photo",
        colors: 1,
        sourcePx: photo.sourcePx,
        lowResolution: photo.soft,
        status: status(item),
        photo,
      };
    });
  mkdirSync(reviewDir, { recursive: true });
  const problems = plan.items.filter((item) => item.problem);
  writePhotoReview(reviewDir, cards, problems.map((item) => `${item.file}: ${item.problem}`));
  const usable = plan.items.filter((item) => item.target && (!item.hasPhoto || replace));
  const soft = cards.filter((card) => card.lowResolution).length;
  console.log(`\n${usable.length} photo(s) ready, ${plan.items.length - usable.length} skipped or kept, ${soft} soft (under ${SOFT_BELOW_PX}px). Review: ${reviewDir}`);

  if (!apply) {
    console.log("Preview only. Run again with --apply to save.");
    await prisma.$disconnect();
    return;
  }

  const { getStorageConfig } = await import("../lib/storage");
  const { storeFor } = await import("../lib/product-image-store");
  const { replaceProductImage } = await import("../lib/product-image-binding");
  const config = getStorageConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so photos cannot upload.");
  const store = storeFor(config);

  let saved = 0;
  const failed: string[] = [];
  for (const item of usable) {
    const target = item.target;
    const photo = encoded.get(item.file);
    if (!target || !photo) continue;
    const bytes = new Uint8Array(photo.buffer);
    try {
      if (target.kind === "colour") {
        const key = { productId_colorId: { productId: target.productId, colorId: target.colorId } };
        const db = {
          find: async () => {
            const row = await prisma.productColorImage.findUnique({ where: key, select: { imageUrl: true, imagePath: true } });
            return { id: target.productId, imageUrl: row?.imageUrl ?? null, imagePath: row?.imagePath ?? null };
          },
          save: async (_id: string, image: { url: string; path: string } | null) => {
            if (image) {
              await prisma.productColorImage.upsert({
                where: key,
                create: { productId: target.productId, colorId: target.colorId, imageUrl: image.url, imagePath: image.path },
                update: { imageUrl: image.url, imagePath: image.path },
              });
            } else {
              await prisma.productColorImage.deleteMany({ where: { productId: target.productId, colorId: target.colorId } });
            }
          },
        };
        const stored = await replaceProductImage(db, store, target.productId, bytes, { mime: "image/webp", ext: "webp" });
        await prisma.auditLog.create({
          data: { action: "PRODUCT_COLOR_IMAGE_SET", entityType: "Product", entityId: target.productId, details: { colorId: target.colorId, path: stored.path, source: "import-photo-folder", file: item.file } },
        });
      } else {
        const db = {
          find: (id: string) => prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true, imagePath: true } }),
          save: async (id: string, image: { url: string; path: string } | null) => {
            await prisma.product.update({ where: { id }, data: { imageUrl: image?.url ?? null, imagePath: image?.path ?? null } });
          },
        };
        const stored = await replaceProductImage(db, store, target.productId, bytes, { mime: "image/webp", ext: "webp" });
        await prisma.auditLog.create({
          data: { action: "PRODUCT_IMAGE_SET", entityType: "Product", entityId: target.productId, details: { path: stored.path, source: "import-photo-folder", file: item.file } },
        });
      }
      saved++;
    } catch (err) {
      failed.push(`${item.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Saved ${saved} photo(s).`);
  for (const f of failed) console.log(`  FAILED ${f}`);
  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
