/**
 * Server-side helpers for style photos: shrinking a picture to WebP under the storage limit, and the review page that
 * shows every picture before anything is uploaded. Used by the scripts, never by the web app.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { compressToTarget, formatBytes } from "@/lib/image-compress";

export interface EncodedPhoto {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Shrinks a picture to WebP under 150 KB, never enlarging it. */
export async function toWebp(source: Buffer): Promise<EncodedPhoto> {
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

export interface PreviewCard {
  style: string;
  description: string;
  colors: number;
  sourcePx: string;
  lowResolution: boolean;
  status: string;
  photo: EncodedPhoto;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const csvCell = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
const CRLF = String.fromCharCode(13, 10);
const BOM = String.fromCharCode(0xfeff);

/** Writes <style>.webp for every card, plus report.csv and a preview.html that carries the pictures inside it. */
export function writePhotoReview(dir: string, cards: PreviewCard[], notes: string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const card of cards) writeFileSync(path.join(dir, `${card.style}.webp`), card.photo.buffer);

  const head = ["style", "description", "colours", "source px", "photo px", "photo size", "check", "status"];
  const lines = [head.map(csvCell).join(",")];
  for (const c of cards) {
    lines.push(
      [c.style, c.description, c.colors, c.sourcePx, `${c.photo.width}x${c.photo.height}`, formatBytes(c.photo.buffer.length), c.lowResolution ? "low resolution" : "", c.status]
        .map(csvCell)
        .join(","),
    );
  }
  writeFileSync(path.join(dir, "report.csv"), BOM + lines.join(CRLF) + CRLF);

  const figures = cards
    .map(
      (c) =>
        `<figure><img src="data:image/webp;base64,${c.photo.buffer.toString("base64")}" alt="${esc(c.style)}"><figcaption><b>${esc(c.style)}</b><br>${esc(c.description)}<br>` +
        `${c.colors} colour(s) · ${c.photo.width}×${c.photo.height} · ${formatBytes(c.photo.buffer.length)}` +
        `${c.lowResolution ? '<br><span class="warn">low resolution</span>' : ""}<br><span class="st">${esc(c.status)}</span></figcaption></figure>`,
    )
    .join("\n");
  const html =
    `<!doctype html><meta charset="utf-8"><title>Style photos</title><style>` +
    `body{font:14px system-ui,sans-serif;margin:16px;background:#fafafa}h1{font-size:18px}.notes{background:#fff7e0;padding:8px 12px;border-radius:6px}` +
    `.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}` +
    `img{width:100%;height:200px;object-fit:contain;background:#fff}figcaption{font-size:12px;margin-top:6px}.warn{color:#b45309}.st{color:#555}</style>` +
    `<h1>Style photos (${cards.length})</h1>${notes.length ? `<div class="notes">${notes.map(esc).join("<br>")}</div>` : ""}<div class="grid">${figures}</div>`;
  writeFileSync(path.join(dir, "preview.html"), html);
}
