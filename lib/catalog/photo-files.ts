/**
 * Matching a folder of photos to styles and colours by file name. Pure: no files, no database.
 *
 *   LW252AN872_01.png    the photo of colour 01 of style LW252AN872 (the colour can be its code or its name)
 *   LW252AN872.jpg       the main photo of the style, shown for any colour that has none of its own
 *
 * A file that cannot be matched with certainty is reported, never guessed.
 */
import { STYLE_CODE } from "@/lib/catalog/style-photos";

const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;

export interface ParsedPhotoName {
  style: string;
  /** What follows the style code: a colour code or a colour name. Null for the main photo of the style. */
  colour: string | null;
}

/** Reads a file name. Returns null when it is not a picture or does not start with a style code. */
export function parsePhotoName(fileName: string): ParsedPhotoName | null {
  if (!IMAGE_EXTENSION.test(fileName)) return null;
  const base = fileName.replace(IMAGE_EXTENSION, "").trim();
  const match = /^([A-Za-z]{2}\d{3}[A-Za-z]{2}\d{3})(?:[\s_-]+(.+))?$/.exec(base);
  if (!match) return null;
  const style = match[1].toUpperCase();
  if (!STYLE_CODE.test(style)) return null;
  const colour = match[2]?.trim();
  return { style, colour: colour ? colour : null };
}

export interface ColourOption {
  colorId: string;
  code: string;
  name: string;
  nameTh: string | null;
}

const words = (value: string) => value.toLowerCase().replace(/[_\-\s]+/g, " ").trim();

/** The colour a file name points at: by code first, then by name (English or Thai), ignoring case and spacing. */
export function matchColour(text: string, options: ColourOption[]): { kind: "match"; colour: ColourOption } | { kind: "none" } | { kind: "ambiguous" } {
  const wanted = words(text);
  const byCode = options.filter((option) => option.code.toLowerCase() === wanted);
  if (byCode.length === 1) return { kind: "match", colour: byCode[0] };
  const byName = options.filter((option) => words(option.name) === wanted || (option.nameTh !== null && words(option.nameTh) === wanted));
  if (byName.length === 1) return { kind: "match", colour: byName[0] };
  return byCode.length + byName.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
}

export interface ProductInfo {
  id: string;
  name: string;
  hasPhoto: boolean;
  /** The colours the style is sold in. */
  colours: ColourOption[];
  /** Colours that already have a photo of their own. */
  colourPhotos: Set<string>;
}

export type PhotoTarget = { kind: "colour"; productId: string; colorId: string; label: string } | { kind: "style"; productId: string };

export interface PlannedPhoto {
  file: string;
  style: string;
  /** Where the photo goes. Absent when there is a problem. */
  target?: PhotoTarget;
  /** True when the target already has a photo, which is kept unless replacing was asked for. */
  hasPhoto?: boolean;
  problem?: string;
}

/** Decides where each file goes. Two files for the same place are both held back. */
export function planPhotoFolder(files: string[], products: ProductInfo[]): { items: PlannedPhoto[]; ignored: string[] } {
  const byStyle = new Map(products.map((product) => [product.name.toUpperCase(), product]));
  const items: PlannedPhoto[] = [];
  const ignored: string[] = [];

  for (const file of files) {
    if (!IMAGE_EXTENSION.test(file)) {
      ignored.push(file);
      continue;
    }
    const parsed = parsePhotoName(file);
    const dangling = /^([A-Za-z]{2}\d{3}[A-Za-z]{2}\d{3})[\s_-]+$/.exec(file.replace(IMAGE_EXTENSION, "").trim());
    if (!parsed && dangling) {
      const style = dangling[1].toUpperCase();
      items.push({ file, style, problem: `The colour is missing after the underscore. Use ${style}_<colour code> for one colour, or ${style}.jpg for the whole style` });
      continue;
    }
    if (!parsed) {
      items.push({ file, style: "", problem: "The name must start with a style code, like LW252AN872_01.png" });
      continue;
    }
    const product = byStyle.get(parsed.style);
    if (!product) {
      items.push({ file, style: parsed.style, problem: `${parsed.style} is not in the system` });
      continue;
    }
    if (parsed.colour === null) {
      items.push({ file, style: parsed.style, target: { kind: "style", productId: product.id }, hasPhoto: product.hasPhoto });
      continue;
    }
    const found = matchColour(parsed.colour, product.colours);
    if (found.kind === "match") {
      items.push({
        file,
        style: parsed.style,
        target: { kind: "colour", productId: product.id, colorId: found.colour.colorId, label: `${found.colour.code} ${found.colour.name}` },
        hasPhoto: product.colourPhotos.has(found.colour.colorId),
      });
    } else {
      const sold = product.colours.map((colour) => `${colour.code} ${colour.name}`).join(", ");
      items.push({
        file,
        style: parsed.style,
        problem: found.kind === "ambiguous" ? `"${parsed.colour}" matches more than one colour of ${parsed.style}` : `"${parsed.colour}" is not a colour of ${parsed.style}. Its colours: ${sold}`,
      });
    }
  }

  // Two files for the same place: neither is used, because there is no way to know which one is meant.
  const places = new Map<string, PlannedPhoto[]>();
  for (const item of items) {
    if (!item.target) continue;
    const key = item.target.kind === "colour" ? `${item.target.productId}|${item.target.colorId}` : `${item.target.productId}|style`;
    places.set(key, [...(places.get(key) ?? []), item]);
  }
  for (const group of Array.from(places.values())) {
    if (group.length < 2) continue;
    for (const item of group) {
      item.problem = `More than one file is for the same place: ${group.map((g) => g.file).join(", ")}`;
      item.target = undefined;
    }
  }
  return { items, ignored };
}
