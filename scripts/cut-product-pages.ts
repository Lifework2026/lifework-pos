// Cuts the colour photos out of product page pictures, following a written plan. Preview by default.
//
//   npx tsx scripts/cut-product-pages.ts "D:/packshot lifework" plan.txt                  preview: cuts, saves nothing
//   npx tsx scripts/cut-product-pages.ts "D:/packshot lifework" plan.txt --apply          uploads and saves the photos
//   npx tsx scripts/cut-product-pages.ts "D:/packshot lifework" plan.txt --apply --replace    also replaces photos that exist
//
// The plan has one line per picture (see lib/catalog/page-cut.ts): `LW252TS405.jpg: 1L=40 1R=00`, or `LW252TS110.webp: STYLE`.
// The boxes are found the way the Photo cutter finds them. Colour codes are the codes of the style's own colours; a colour
// the style does not have is reported and skipped. Photos that already exist are kept unless --replace is given.
// Open exports/photo-cut-review/preview.html to look at every cut before applying.

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { findPhotoBlocks, type Box } from "../lib/catalog/photo-detect";
import { joinBoxes, padInBlank, parseCutPlan, splitBox, trimLabelBelow, type Cut } from "../lib/catalog/page-cut";
import { toWebp, writePhotoReview, type EncodedPhoto, type PreviewCard } from "../lib/catalog/style-photo-files";

const args = process.argv.slice(2);
const [folder, planFile] = args.filter((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const replace = args.includes("--replace");
const reviewDir = path.resolve(process.cwd(), "exports", "photo-cut-review");
const SOFT_BELOW_PX = 500;

if (!folder || !planFile) {
  console.error('Usage: npx tsx scripts/cut-product-pages.ts "<folder>" <plan file> [--apply] [--replace]');
  process.exit(2);
}

interface Job {
  file: string;
  label: string;
  target: { kind: "colour"; productId: string; colorId: string } | { kind: "style"; productId: string };
  photo?: EncodedPhoto;
  sourcePx: string;
  soft: boolean;
  keep: boolean;
  trimmed?: boolean;
  problem?: string;
  style: string;
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");
  const { lines, errors } = parseCutPlan(readFileSync(path.resolve(planFile), "utf8"));
  if (errors.length) {
    for (const e of errors) console.error(`  PLAN ${e}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const styleOf = (file: string) => /^(LW\d{3}[A-Z]{2}\d{3})/i.exec(file)?.[1].toUpperCase() ?? "";
  const products = await prisma.product.findMany({
    where: { name: { in: lines.map((l) => styleOf(l.file)) } },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      variants: { select: { colorId: true, colorRef: { select: { code: true, name: true } } } },
      colorImages: { select: { colorId: true } },
    },
  });
  const byStyle = new Map(products.map((p) => [p.name, p]));
  const dir = path.resolve(folder as string);
  const jobs: Job[] = [];

  for (const line of lines) {
    const style = styleOf(line.file);
    const product = byStyle.get(style);
    const fail = (label: string, problem: string) =>
      jobs.push({ file: line.file, style, label, target: { kind: "style", productId: product?.id ?? "" }, sourcePx: "", soft: false, keep: false, problem });
    if (!product) {
      fail("-", `style ${style} is not in the system`);
      continue;
    }
    const source = readFileSync(path.join(dir, line.file));
    const meta = await sharp(source).metadata();
    const sourcePx = `${meta.width}x${meta.height}`;
    const soft = Math.max(meta.width ?? 0, meta.height ?? 0) < SOFT_BELOW_PX;
    const flat = sharp(source).flatten({ background: "#ffffff" });
    const { data: grey, info } = await flat.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
    const boxes = findPhotoBlocks(grey, info.width, info.height, { inkBelow: 245 });
    const colour = new Map(product.variants.map((v) => [v.colorRef.code, { colorId: v.colorId, name: v.colorRef.name }]));

    if (line.style) {
      const photo = await toWebp(await flat.clone().png().toBuffer());
      jobs.push({ file: line.file, style, label: "style photo", target: { kind: "style", productId: product.id }, photo, sourcePx, soft, keep: !!product.imageUrl && !replace });
    }
    for (const cut of line.cuts) {
      const found = colour.get(cut.colour);
      const label = found ? `colour ${cut.colour} ${found.name}` : `colour ${cut.colour}`;
      if (!found) {
        fail(label, `${style} has no colour ${cut.colour} (it has ${Array.from(colour.keys()).join(", ")})`);
        continue;
      }
      if (cut.whole) {
        const photo = await toWebp(await flat.clone().png().toBuffer());
        const hasOwn = product.colorImages.some((c) => c.colorId === found.colorId);
        jobs.push({ file: line.file, style, label, target: { kind: "colour", productId: product.id, colorId: found.colorId }, photo, sourcePx, soft, keep: hasOwn && !replace });
        continue;
      }
      const box = cutBox(cut, boxes, grey, info.width);
      if (typeof box === "string") {
        fail(label, `${box} (found ${boxes.length} box(es))`);
        continue;
      }
      const padded = padInBlank(grey, info.width, info.height, box.box, 0.03);
      const photo = await toWebp(await flat.clone().extract({ left: padded.x, top: padded.y, width: padded.width, height: padded.height }).png().toBuffer());
      const hasOwn = product.colorImages.some((c) => c.colorId === found.colorId);
      jobs.push({ file: line.file, style, label, target: { kind: "colour", productId: product.id, colorId: found.colorId }, photo, sourcePx, soft, keep: hasOwn && !replace, trimmed: box.trimmed });
    }
  }

  console.log("");
  for (const job of jobs) {
    const state = job.problem ? `SKIPPED: ${job.problem}` : job.keep ? "kept: already has a photo (use --replace)" : job.trimmed ? "ready (colour name cut off)" : "ready";
    console.log(`  ${job.file.padEnd(24)} ${job.label.padEnd(28)} ${state}`);
  }
  const cards: PreviewCard[] = jobs
    .filter((job) => job.photo)
    .map((job) => ({
      style: `${job.style}_${job.target.kind === "colour" ? job.label.split(" ")[1] : "STYLE"}`,
      description: job.label,
      colors: 1,
      sourcePx: job.sourcePx,
      lowResolution: job.soft,
      status: job.keep ? "kept" : "ready",
      photo: job.photo as EncodedPhoto,
    }));
  mkdirSync(reviewDir, { recursive: true });
  const problems = jobs.filter((job) => job.problem);
  writePhotoReview(reviewDir, cards, problems.map((job) => `${job.file} ${job.label}: ${job.problem}`));
  const usable = jobs.filter((job) => job.photo && !job.problem && !job.keep);
  console.log(`\n${usable.length} photo(s) ready, ${jobs.length - usable.length} skipped or kept, ${cards.filter((c) => c.lowResolution).length} soft (under ${SOFT_BELOW_PX}px). Review: ${reviewDir}`);

  if (!apply) {
    console.log("Preview only. Run again with --apply to save.");
    await prisma.$disconnect();
    return;
  }

  const { getStorageConfig } = await import("../lib/storage");
  const { storeFor } = await import("../lib/product-image-store");
  const { savePhoto } = await import("../lib/catalog/photo-save");
  const config = getStorageConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so photos cannot upload.");
  const store = storeFor(config);
  let saved = 0;
  const failed: string[] = [];
  for (const job of usable) {
    try {
      await savePhoto(prisma, store, job.target, new Uint8Array((job.photo as EncodedPhoto).buffer), { script: "cut-product-pages", file: job.file });
      saved++;
    } catch (err) {
      failed.push(`${job.file} ${job.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Saved ${saved} photo(s).`);
  for (const f of failed) console.log(`  FAILED ${f}`);
  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
}

/** The box for one cut: the named boxes (or halves of them), joined, with a caught colour name trimmed off. */
function cutBox(cut: Cut, boxes: Box[], grey: Uint8Array, width: number): { box: Box; trimmed: boolean } | string {
  const parts: Box[] = [];
  for (const part of cut.parts) {
    const box = boxes[part.box - 1];
    if (!box) return `there is no box ${part.box}`;
    parts.push(part.side ? splitBox(grey, width, box, part.side) : box);
  }
  return trimLabelBelow(grey, width, joinBoxes(parts));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
