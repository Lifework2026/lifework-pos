import type { Prisma } from "@prisma/client";

/**
 * Filters for the admin product list: style SKU, category code, active state and photo. Pure, so it can be tested
 * without a database. The values come straight from the page address, so each one is cleaned before it is used.
 */

export interface ProductFilterParams {
  q?: string;
  category?: string;
  color?: string;
  status?: string;
  image?: string;
}

export interface ProductFilter {
  /** Style SKU or any part of a name, brand, variant SKU or barcode. */
  q: string;
  /** A category code such as TS, or "" for all. */
  category: string;
  /** A colour code such as 00, or "" for all colours. */
  color: string;
  status: "" | "active" | "inactive";
  /** "missing" keeps products with a colour that shows no photo. It is decided from the photos, in the page. */
  image: "" | "missing";
}

export function parseProductFilter(params: ProductFilterParams): ProductFilter {
  const category = (params.category ?? "").trim().toUpperCase();
  const color = (params.color ?? "").trim().toUpperCase();
  return {
    q: (params.q ?? "").trim().slice(0, 100),
    category: /^[A-Z0-9-]{1,20}$/.test(category) ? category : "",
    color: /^[A-Z0-9-]{1,20}$/.test(color) ? color : "",
    status: params.status === "active" || params.status === "inactive" ? params.status : "",
    image: params.image === "missing" ? "missing" : "",
  };
}

/**
 * A product's name is its style SKU when the catalogue was imported from a packing list, and its variants' SKUs start
 * with the style. So one search finds the style by name or by any of its variant SKUs, ignoring case.
 */
export function productWhere(filter: ProductFilter): Prisma.ProductWhereInput {
  return {
    ...(filter.category ? { category: { code: filter.category } } : {}),
    ...(filter.status ? { isActive: filter.status === "active" } : {}),
    ...(filter.color ? { variants: { some: { colorRef: { code: filter.color } } } } : {}),
    ...(filter.q
      ? {
          OR: [
            { name: { contains: filter.q, mode: "insensitive" } },
            { nameTh: { contains: filter.q, mode: "insensitive" } },
            { brand: { contains: filter.q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: filter.q, mode: "insensitive" } } } },
            { variants: { some: { barcode: filter.q } } },
          ],
        }
      : {}),
  };
}
