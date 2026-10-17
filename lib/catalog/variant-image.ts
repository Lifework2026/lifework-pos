/**
 * Which photo a variant shows, and how many of a product's colours have one. Client-safe and pure.
 *
 * Photos belong to a colour, not to a size: every size of the same product in the same colour shares one photo. A
 * colour with no photo of its own shows the product photo instead, so a product that only has one photo keeps working.
 */

export interface ColorImageRef {
  colorId: string;
  imageUrl: string;
}

/** The photo a variant shows: its colour's photo, else the product photo, else none. */
export function variantImageUrl(product: { imageUrl: string | null; colorImages: ColorImageRef[] }, colorId: string): string | null {
  const own = product.colorImages.find((image) => image.colorId === colorId);
  return own?.imageUrl ?? product.imageUrl;
}

export interface PhotoCoverage {
  /** Different colours the product is sold in. */
  colors: number;
  /** Colours that show a photo, their own or the product photo. */
  withPhoto: number;
  /** Colours that show no photo at all. */
  missing: number;
}

export function photoCoverage(product: {
  imageUrl: string | null;
  variants: { colorId: string }[];
  colorImages: { colorId: string }[];
}): PhotoCoverage {
  const colors = new Set(product.variants.map((variant) => variant.colorId));
  const own = new Set(product.colorImages.map((image) => image.colorId));
  let withPhoto = 0;
  colors.forEach((colorId) => {
    if (own.has(colorId) || product.imageUrl) withPhoto += 1;
  });
  return { colors: colors.size, withPhoto, missing: colors.size - withPhoto };
}

export interface ColorGroup {
  colorId: string;
  /** The colour name as the variants carry it. */
  color: string;
  /** The sizes sold in this colour, in the order the variants come. */
  sizes: string[];
}

/** One group per colour, each with its sizes. This is what the photo section shows: one photo slot per group. */
export function colorGroups(variants: { colorId: string; color: string; size: string }[]): ColorGroup[] {
  const groups: ColorGroup[] = [];
  for (const variant of variants) {
    let group = groups.find((g) => g.colorId === variant.colorId);
    if (!group) {
      group = { colorId: variant.colorId, color: variant.color, sizes: [] };
      groups.push(group);
    }
    if (group.sizes.indexOf(variant.size) < 0) group.sizes.push(variant.size);
  }
  return groups;
}
