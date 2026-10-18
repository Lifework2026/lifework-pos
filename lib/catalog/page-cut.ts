/**
 * Cutting colour photos out of product page pictures from a written plan. Pure: it works on grey values and text, so it is
 * tested without pictures or a database.
 *
 * The plan has one line per picture: `LW252TS405.jpg: 1L=40 1R=00`. Each token says which part of the picture is the photo of
 * which colour (the colour code of the style):
 *   2=40     box 2 (numbered as the Photo cutter numbers them: row by row, left to right) is colour 40
 *   1+2=48   boxes 1 and 2 joined (a front and a back view that were found apart)
 *   1L=40    the left photo of box 1 (two colours found as one box are cut apart at the widest blank gap); 1R is the right one
 *   STYLE    the whole picture is the style photo, for pictures that only show all colours together
 * Boxes the plan does not mention are left out (text blocks, colours the shop does not stock).
 */
import type { Box } from "./photo-detect";

export type Part = { box: number; side?: "L" | "R" };
export interface Cut {
  parts: Part[];
  colour: string;
}
export interface CutPlanLine {
  file: string;
  style: boolean;
  cuts: Cut[];
}

const TOKEN = /^(\d+(?:[LR]|(?:\+\d+)*))=([A-Za-z0-9]+)$/;

export function parseCutPlan(text: string): { lines: CutPlanLine[]; errors: string[] } {
  const lines: CutPlanLine[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const at = line.indexOf(":");
    if (at < 1) {
      errors.push(`line ${index + 1}: expected "file: tokens"`);
      return;
    }
    const file = line.slice(0, at).trim();
    if (seen.has(file)) errors.push(`line ${index + 1}: ${file} is in the plan twice`);
    seen.add(file);
    const entry: CutPlanLine = { file, style: false, cuts: [] };
    const colours = new Set<string>();
    for (const token of line.slice(at + 1).trim().split(/\s+/).filter(Boolean)) {
      if (token === "STYLE") {
        entry.style = true;
        continue;
      }
      const m = TOKEN.exec(token);
      if (!m) {
        errors.push(`line ${index + 1}: cannot read "${token}"`);
        continue;
      }
      const [, where, colour] = m;
      if (colours.has(colour)) errors.push(`line ${index + 1}: colour ${colour} is given twice for ${file}`);
      colours.add(colour);
      const side = /[LR]$/.exec(where)?.[0] as "L" | "R" | undefined;
      const parts = where.replace(/[LR]$/, "").split("+").map((n) => ({ box: Number(n), side }));
      entry.cuts.push({ parts, colour });
    }
    if (!entry.style && entry.cuts.length === 0) errors.push(`line ${index + 1}: ${file} has nothing to cut`);
    lines.push(entry);
  });
  return { lines, errors };
}

const INK = 245;

function columnInk(grey: ArrayLike<number>, width: number, box: Box): number[] {
  const counts = new Array<number>(box.width).fill(0);
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = 0; x < box.width; x++) if (grey[y * width + box.x + x] < INK) counts[x]++;
  }
  return counts;
}

function rowInk(grey: ArrayLike<number>, width: number, box: Box): number[] {
  const counts = new Array<number>(box.height).fill(0);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) if (grey[(box.y + y) * width + box.x + x] < INK) counts[y]++;
  }
  return counts;
}

/** The smallest box around the ink inside a box. */
export function tighten(grey: ArrayLike<number>, width: number, box: Box): Box {
  let left = box.x + box.width;
  let right = box.x - 1;
  let top = box.y + box.height;
  let bottom = box.y - 1;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      if (grey[y * width + x] >= INK) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return box;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Two photos found as one box, cut apart at the widest blank gap in the middle of it. Returns the left or the right one. */
export function splitBox(grey: ArrayLike<number>, width: number, box: Box, side: "L" | "R"): Box {
  const ink = columnInk(grey, width, box);
  const quiet = Math.max(1, Math.round(box.height * 0.004));
  const from = Math.floor(box.width * 0.25);
  const to = Math.ceil(box.width * 0.75);
  let bestStart = -1;
  let bestLength = 0;
  for (let x = from; x < to; ) {
    if (ink[x] > quiet) {
      x++;
      continue;
    }
    const start = x;
    while (x < to && ink[x] <= quiet) x++;
    if (x - start > bestLength) {
      bestLength = x - start;
      bestStart = start;
    }
  }
  // No blank gap (the two touch): cut where there is the least ink.
  const cut = bestLength > 0 ? bestStart + Math.floor(bestLength / 2) : from + ink.slice(from, to).reduce((best, v, i, all) => (v < all[best] ? i : best), 0);
  const part: Box = side === "L" ? { x: box.x, y: box.y, width: cut, height: box.height } : { x: box.x + cut, y: box.y, width: box.width - cut, height: box.height };
  return tighten(grey, width, part);
}

/**
 * The colour name written just under a photo is sometimes caught in its box. A band of ink at the very bottom, cut off from the
 * photo by blank rows and short compared with the box, is that name, so the box ends above it.
 */
export function trimLabelBelow(grey: ArrayLike<number>, width: number, box: Box): { box: Box; trimmed: boolean } {
  const rows = rowInk(grey, width, box);
  // A few stray dots under the name (the edge of the letters) do not count as ink.
  const quiet = Math.max(1, Math.round(box.width * 0.03));
  const lowest = Math.floor(box.height * 0.7);
  const maxBand = Math.round(box.height * 0.15);
  let y = rows.length - 1;
  // The band of ink at the bottom.
  while (y >= 0 && rows[y] <= quiet) y--;
  if (y < lowest) return { box, trimmed: false };
  const bandBottom = y;
  while (y >= 0 && rows[y] > quiet) y--;
  const bandTop = y + 1;
  if (bandBottom - bandTop + 1 > maxBand) return { box, trimmed: false };
  // The blank rows above the band: it is cut off from the photo.
  let gap = 0;
  while (y >= 0 && rows[y] <= quiet) {
    gap++;
    y--;
  }
  if (y < 0 || gap < 2) return { box, trimmed: false };
  // Thin things hanging from the photo (a cord and its toggle) count as blank above but belong to it: keep them down to their end.
  let end = y;
  while (end + 1 < bandTop && rows[end + 1] > 0) end++;
  return { box: tighten(grey, width, { x: box.x, y: box.y, width: box.width, height: end + 1 }), trimmed: true };
}

export function joinBoxes(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}
