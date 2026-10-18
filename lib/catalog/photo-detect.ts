/**
 * Finding the colour photos on a product page picture. Pure: it works on grey values, so it runs in the browser and in tests.
 *
 * A product page picture is a long white strip: a title, a paragraph, then the photo of each colour with its name under
 * it. The photos are solid blobs of ink; text is thin strokes. The picture is thickened a little so each photo (a front and
 * back view of one colour included) becomes one connected region, and the regions that are big and dense enough to be a photo
 * are returned. Text is told apart from a photo by how its ink is joined: a photo is a few large pieces, a paragraph is
 * hundreds of separate letters. The colour name under a photo is a small region and is left out. This is a suggestion: the person looking
 * at the picture draws, moves or removes boxes, and chooses the colour of each one.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectOptions {
  /** A pixel darker than this (0-255) counts as ink. */
  inkBelow?: number;
  /** A photo is at least this fraction of the picture width, in both directions. */
  minSize?: number;
  /** Ink as a fraction of the box area. Only drops stray lines; text is rejected by the next setting. */
  minDensity?: number;
  /** The biggest connected piece of ink must hold at least this share of all the ink in the box. A photo does, letters do not. */
  minSolid?: number;
}

const CELL = 3;

export function findPhotoBlocks(grey: ArrayLike<number>, width: number, height: number, options: DetectOptions = {}): Box[] {
  const inkBelow = options.inkBelow ?? 235;
  const minSize = Math.round(width * (options.minSize ?? 0.1));
  const minDensity = options.minDensity ?? 0.05;
  const minSolid = options.minSolid ?? 0.3;

  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cellInk = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grey[y * width + x] < inkBelow) cellInk[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1;
    }
  }

  // Thicken so the parts of one photo join up: sideways by about 2.5% of the width each way (a front and a back view side by
  // side), but up and down only 1.5% (views stacked close), so the colour name a little way below a photo does not join it.
  const radiusX = Math.max(2, Math.round((width * 0.025) / CELL));
  const radiusY = Math.max(2, Math.round((width * 0.015) / CELL));
  const horizontal = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cellInk[r * cols + c]) continue;
      for (let k = Math.max(0, c - radiusX); k <= Math.min(cols - 1, c + radiusX); k++) horizontal[r * cols + k] = 1;
    }
  }
  const grown = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!horizontal[r * cols + c]) continue;
      for (let k = Math.max(0, r - radiusY); k <= Math.min(rows - 1, r + radiusY); k++) grown[k * cols + c] = 1;
    }
  }

  // Connected regions of the thickened picture.
  const seen = new Uint8Array(cols * rows);
  const regions: { left: number; top: number; right: number; bottom: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || seen[start]) continue;
    let left = cols;
    let right = -1;
    let top = rows;
    let bottom = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const r = Math.floor(cell / cols);
      const c = cell % cols;
      if (c < left) left = c;
      if (c > right) right = c;
      if (r < top) top = r;
      if (r > bottom) bottom = r;
      for (const next of [c > 0 ? cell - 1 : -1, c < cols - 1 ? cell + 1 : -1, r > 0 ? cell - cols : -1, r < rows - 1 ? cell + cols : -1]) {
        if (next >= 0 && grown[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    regions.push({ left, top, right, bottom });
  }

  const boxes: Box[] = [];
  for (const region of regions) {
    const x0 = region.left * CELL;
    const y0 = region.top * CELL;
    const x1 = Math.min(width, (region.right + 1) * CELL);
    const y1 = Math.min(height, (region.bottom + 1) * CELL);
    // The tight box around the real ink, and how much of it is ink.
    let left = x1;
    let right = x0;
    let top = y1;
    let bottom = y0;
    let ink = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (grey[y * width + x] >= inkBelow) continue;
        ink++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (ink === 0) continue;
    const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    if (box.width < minSize || box.height < minSize) continue;
    if (ink / (box.width * box.height) < minDensity) continue;
    if (solidShare(cellInk, cols, rows, region) < minSolid) continue;
    boxes.push(box);
  }

  // Reading order: row by row, left to right. Boxes whose tops are close belong to one row.
  const rowGap = Math.round(width * 0.08);
  boxes.sort((a, b) => (Math.abs(a.y - b.y) > rowGap ? a.y - b.y : a.x - b.x));
  return boxes;
}

/** The share of the ink cells inside a region that belong to its biggest connected piece (neighbours include diagonals). */
function solidShare(cellInk: Uint8Array, cols: number, rows: number, region: { left: number; top: number; right: number; bottom: number }): number {
  const visited = new Set<number>();
  let total = 0;
  let largest = 0;
  for (let r = region.top; r <= region.bottom; r++) {
    for (let c = region.left; c <= region.right; c++) if (cellInk[r * cols + c]) total++;
  }
  if (total === 0) return 0;
  for (let r = region.top; r <= region.bottom; r++) {
    for (let c = region.left; c <= region.right; c++) {
      const start = r * cols + c;
      if (!cellInk[start] || visited.has(start)) continue;
      let size = 0;
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const cell = stack.pop() as number;
        size++;
        const cr = Math.floor(cell / cols);
        const cc = cell % cols;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr < region.top || nr > region.bottom || nc < region.left || nc > region.right) continue;
            const next = nr * cols + nc;
            if (cellInk[next] && !visited.has(next)) {
              visited.add(next);
              stack.push(next);
            }
          }
        }
      }
      if (size > largest) largest = size;
    }
  }
  return largest / total;
}

/** A box grown by a margin (a fraction of its larger side), kept inside the picture. */
export function padBox(box: Box, imageWidth: number, imageHeight: number, margin = 0.04): Box {
  const pad = Math.round(Math.max(box.width, box.height) * margin);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return { x, y, width: Math.min(imageWidth, box.x + box.width + pad) - x, height: Math.min(imageHeight, box.y + box.height + pad) - y };
}
