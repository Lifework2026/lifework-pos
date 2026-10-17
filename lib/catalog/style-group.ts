/**
 * Reading a style's colours and sizes. Client-safe and pure. The till shows one card per style; these helpers produce
 * what the card and the colour/size picker show, and turn the picked variant back into the shape the cart takes.
 */
import type { StyleSummary, StyleVariant, VariantSummary } from "@/lib/pos-types";

const NAMED_SIZES = ["XXS", "2XS", "XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "XXXL", "4XL", "F", "FREE", "ONE SIZE"];

/** Sort key for a size: named sizes in order of the garment, then numbers (shoes) by value, then anything else. */
function sizeRank(size: string): number {
  const named = NAMED_SIZES.indexOf(size.trim().toUpperCase());
  if (named >= 0) return named;
  const numeric = Number(size);
  if (Number.isFinite(numeric)) return 1000 + numeric;
  return 100_000;
}

export function compareSizes(a: string, b: string): number {
  return sizeRank(a) - sizeRank(b) || a.localeCompare(b);
}

export interface StyleColor {
  colorId: string;
  name: string;
  imageUrl: string | null;
  /** Units in stock across this colour's sizes. */
  stock: number;
}

/** The colours of a style, by name, each once. */
export function styleColors(variants: StyleVariant[]): StyleColor[] {
  const byId = new Map<string, StyleColor>();
  for (const variant of variants) {
    const found = byId.get(variant.colorId);
    if (found) {
      found.stock += Math.max(0, variant.stockQuantity);
      if (!found.imageUrl) found.imageUrl = variant.imageUrl;
    } else {
      byId.set(variant.colorId, { colorId: variant.colorId, name: variant.color, imageUrl: variant.imageUrl, stock: Math.max(0, variant.stockQuantity) });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** The sizes of a style, in garment order, each once. */
export function styleSizes(variants: StyleVariant[]): string[] {
  return Array.from(new Set(variants.map((variant) => variant.size))).sort(compareSizes);
}

/** The variants of one colour, in size order. */
export function variantsOfColor(variants: StyleVariant[], colorId: string): StyleVariant[] {
  return variants.filter((variant) => variant.colorId === colorId).sort((a, b) => compareSizes(a.size, b.size));
}

export function totalStock(variants: StyleVariant[]): number {
  return variants.reduce((sum, variant) => sum + Math.max(0, variant.stockQuantity), 0);
}

export function priceRange(variants: StyleVariant[]): { min: number; max: number } {
  const prices = variants.map((variant) => Number(variant.price));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** "2 COLORS · F" or "1 COLOR · 5 SIZES": how many colours, and the size itself when there is only one. */
export function styleBadge(variants: StyleVariant[]): string {
  const colors = new Set(variants.map((variant) => variant.colorId)).size;
  const sizes = styleSizes(variants);
  const colorText = colors === 1 ? "1 COLOR" : `${colors} COLORS`;
  const sizeText = sizes.length === 1 ? sizes[0] : `${sizes.length} SIZES`;
  return `${colorText} · ${sizeText}`;
}

/**
 * What the picker has selected when it opens: the first colour that has stock (else the first colour) and, when that
 * colour comes in one size only, that size too. Nothing is chosen for the cashier when there is a real choice.
 */
export function defaultSelection(variants: StyleVariant[]): { colorId: string | null; variantId: string | null } {
  const colors = styleColors(variants);
  const color = colors.find((c) => c.stock > 0) ?? colors[0];
  if (!color) return { colorId: null, variantId: null };
  const ofColor = variantsOfColor(variants, color.colorId);
  return { colorId: color.colorId, variantId: ofColor.length === 1 ? ofColor[0].id : null };
}

/** The cart takes the same shape the barcode lookup returns. */
export function toVariantSummary(style: StyleSummary, variant: StyleVariant): VariantSummary {
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    size: variant.size,
    color: variant.color,
    price: variant.price,
    stockQuantity: variant.stockQuantity,
    product: {
      id: style.id,
      name: style.name,
      nameTh: style.nameTh,
      imageUrl: variant.imageUrl,
      promoTag: style.promoTag,
      brand: style.brand,
      categoryId: style.categoryId,
    },
  };
}
