// Turns the brand pictures in public/brand-assets (JPEG, with a solid background) into clean transparent PNGs in
// public/brand, which is what the till uses:
//
//   radog.png           the French bulldog head, black line art      <- 90ffd75609004e05b7b9e04923f41806.jpg (head only, text cropped off)
//   main-logo.png       LifeWork HIDEAWAY wordmark, black            <- images (3).jpg
//   main-logo-white.png LifeWork HIDEAWAY wordmark, white            <- images.png
//
// The JPEG background becomes transparent: how dark (or how light) a pixel is becomes how opaque it is, so the lines keep
// their soft edges and a logo sits on any colour. Run again if a source picture is replaced:
//
//   npx tsx scripts/prepare-brand-assets.ts

import path from "node:path";
import sharp from "sharp";

const SOURCES = path.resolve(process.cwd(), "public", "brand-assets");
const OUT = path.resolve(process.cwd(), "public", "brand");

interface Art {
  width: number;
  height: number;
  /** One byte per pixel: how opaque the artwork is there. */
  alpha: Uint8Array;
}

/** Reads a picture and turns it into an opacity map. `ink` says whether the artwork is the dark or the light part. */
async function readArt(file: string, ink: "dark" | "light"): Promise<Art> {
  const { data, info } = await sharp(path.join(SOURCES, file)).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) {
    const strength = ink === "dark" ? 255 - data[i] : data[i];
    // Levels: noise below 24 is background, above 230 is solid.
    alpha[i] = strength < 24 ? 0 : strength > 230 ? 255 : Math.round(((strength - 24) * 255) / 206);
  }
  return { width: info.width, height: info.height, alpha };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The smallest box that holds every pixel at least `min` opaque, inside rows [fromRow, toRow). */
function boundingBox(art: Art, fromRow = 0, toRow = art.height, min = 40): Box {
  let left = art.width;
  let right = -1;
  let top = art.height;
  let bottom = -1;
  for (let y = fromRow; y < toRow; y++) {
    for (let x = 0; x < art.width; x++) {
      if (art.alpha[y * art.width + x] >= min) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error("The picture has no artwork in it.");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** The rows of the first block of artwork: it ends at the first run of at least `gap` empty rows. */
function firstBlockRows(art: Art, gap = 6): [number, number] {
  const filled = (y: number) => {
    for (let x = 0; x < art.width; x++) if (art.alpha[y * art.width + x] >= 40) return true;
    return false;
  };
  let start = -1;
  let empty = 0;
  for (let y = 0; y < art.height; y++) {
    if (filled(y)) {
      if (start < 0) start = y;
      empty = 0;
    } else if (start >= 0 && ++empty >= gap) return [start, y - empty + 1];
  }
  return [Math.max(start, 0), art.height];
}

async function writePng(art: Art, box: Box, colour: [number, number, number], file: string, padding: number): Promise<void> {
  const pad = Math.round(Math.max(box.width, box.height) * padding);
  const width = box.width + pad * 2;
  const height = box.height + pad * 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const out = ((y + pad) * width + (x + pad)) * 4;
      rgba[out] = colour[0];
      rgba[out + 1] = colour[1];
      rgba[out + 2] = colour[2];
      rgba[out + 3] = art.alpha[(box.top + y) * art.width + (box.left + x)];
    }
  }
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log(`${file}: ${width}x${height}`);
}

async function main(): Promise<void> {
  // The bulldog head: black on white, with the wordmark under it. Keep only the first block of artwork, the head.
  const head = await readArt("90ffd75609004e05b7b9e04923f41806.jpg", "dark");
  const [from, to] = firstBlockRows(head);
  await writePng(head, boundingBox(head, from, to), [9, 9, 11], "radog.png", 0.04);

  const wordmark = await readArt("images (3).jpg", "dark");
  await writePng(wordmark, boundingBox(wordmark), [9, 9, 11], "main-logo.png", 0.02);

  const white = await readArt("images.png", "light");
  await writePng(white, boundingBox(white), [255, 255, 255], "main-logo-white.png", 0.02);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
