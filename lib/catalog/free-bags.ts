/**
 * The free shopping bags: paper and rPET, each in S, M and L, at 0 baht. Client-safe and pure.
 *
 * They are ordinary product variants (no schema change), but they are not counted: a free bag can always be added and
 * sold, whatever the stock figure says, and a sale takes nothing off the stock and writes nothing to the stock ledger.
 * The code recognises them by SKU, so this file is the one place that says which variants those are.
 */

export const FREE_BAG_TYPES = [
  { key: "PAPER", name: "Paper Bag", nameTh: "ถุง Paper", label: "Paper" },
  { key: "RPET", name: "Rpet Bag", nameTh: "ถุง Rpet", label: "Rpet" },
] as const;

export const FREE_BAG_SIZES = ["S", "M", "L"] as const;

export type FreeBagType = (typeof FREE_BAG_TYPES)[number]["key"];
export type FreeBagSize = (typeof FREE_BAG_SIZES)[number];

/** BAG-PAPER-S, BAG-RPET-L, and so on. The SKU is also the barcode. */
export function freeBagSku(type: FreeBagType, size: FreeBagSize): string {
  return `BAG-${type}-${size}`;
}

const FREE_BAG_SKU = /^BAG-(PAPER|RPET)-[SML]$/;

export function isFreeBag(sku: string): boolean {
  return FREE_BAG_SKU.test(sku);
}

/** Slugs of the two bag products, so the sales grid can leave them out (they are added from the bag selector). */
export const FREE_BAG_PRODUCT_SLUGS: string[] = FREE_BAG_TYPES.map((bag) => `${bag.key.toLowerCase()}-bag`);

/** Stock figure the till uses for a free bag in the cart, so the cart never limits it. */
export const FREE_BAG_CART_STOCK = 9999;

/** All six variants, for the seed script and the tests. */
export function allFreeBags(): { type: FreeBagType; size: FreeBagSize; sku: string }[] {
  return FREE_BAG_TYPES.flatMap((bag) => FREE_BAG_SIZES.map((size) => ({ type: bag.key, size, sku: freeBagSku(bag.key, size) })));
}
