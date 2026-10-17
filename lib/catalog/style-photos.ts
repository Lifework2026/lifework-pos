/**
 * Choosing one photo per style from a supplier sheet. Pure: the script reads the workbook and the images, this decides.
 *
 * The sheet repeats a style's picture on every colour and size row, and the copies are often re-encoded at slightly
 * different sizes, so they cannot be told apart by their bytes. Every row of a style shows the same picture, so the
 * style gets the largest copy, which is the sharpest one the sheet has.
 */

/** LW262TS116: brand (2 letters), season (3 digits), category (2 letters), model (3 digits). */
export const STYLE_CODE = /^[A-Z]{2}\d{3}[A-Z]{2}\d{3}$/;

/** Below this many pixels on the long side a photo looks soft on the till. */
export const LOW_RESOLUTION_PX = 200;

export interface SheetImage {
  width: number;
  height: number;
}

export interface SheetRow {
  /** The row number in the sheet, for messages. */
  row: number;
  style: string;
  colorCode: string;
  barcode: string;
  description: string;
  /** Index into the image list, or null when the row has no picture. */
  image: number | null;
}

export interface StylePick {
  style: string;
  description: string;
  /** Index of the chosen image. */
  image: number;
  width: number;
  height: number;
  rows: number;
  colors: string[];
  barcodes: string[];
  lowResolution: boolean;
}

export interface StylePlan {
  picks: StylePick[];
  /** Styles in the sheet that have no picture on any row. */
  withoutImage: string[];
  /** Rows whose product code is not a style code (totals, notes, blank). */
  ignored: { row: number; value: string }[];
}

export function normalizeStyle(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function planStylePhotos(rows: SheetRow[], images: SheetImage[]): StylePlan {
  const groups = new Map<string, SheetRow[]>();
  const ignored: StylePlan["ignored"] = [];
  for (const row of rows) {
    if (!STYLE_CODE.test(row.style)) {
      if (row.style || row.barcode) ignored.push({ row: row.row, value: row.style });
      continue;
    }
    const list = groups.get(row.style) ?? [];
    list.push(row);
    groups.set(row.style, list);
  }

  const picks: StylePick[] = [];
  const withoutImage: string[] = [];
  for (const [style, list] of Array.from(groups.entries())) {
    let best: number | null = null;
    for (const row of list) {
      if (row.image === null || !images[row.image]) continue;
      const area = images[row.image].width * images[row.image].height;
      if (best === null || area > images[best].width * images[best].height) best = row.image;
    }
    if (best === null) {
      withoutImage.push(style);
      continue;
    }
    const size = images[best];
    picks.push({
      style,
      description: list.find((r) => r.description)?.description ?? "",
      image: best,
      width: size.width,
      height: size.height,
      rows: list.length,
      colors: Array.from(new Set(list.map((r) => r.colorCode).filter(Boolean))),
      barcodes: list.map((r) => r.barcode).filter(Boolean),
      lowResolution: Math.max(size.width, size.height) < LOW_RESOLUTION_PX,
    });
  }
  return { picks, withoutImage, ignored };
}

export interface ProductMatch {
  productId: string;
  hasPhoto: boolean;
}

export type StyleOutcome =
  | { kind: "set"; productIds: string[] }
  | { kind: "skip-has-photo"; productIds: string[] }
  | { kind: "not-in-system" };

/**
 * What to do with a style, given the products its barcodes belong to. A style whose products already have a photo is
 * left alone unless replace is set, so running the import twice, or after photos were uploaded by hand, never
 * overwrites anyone's work.
 */
export function decideStyle(matches: ProductMatch[], replace: boolean): StyleOutcome {
  if (matches.length === 0) return { kind: "not-in-system" };
  const todo = replace ? matches : matches.filter((m) => !m.hasPhoto);
  if (todo.length === 0) return { kind: "skip-has-photo", productIds: matches.map((m) => m.productId) };
  return { kind: "set", productIds: todo.map((m) => m.productId) };
}
