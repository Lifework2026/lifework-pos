import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, formatMoney } from "@/lib/api";
import type { StyleSummary } from "@/lib/pos-types";
import { variantImageUrl } from "@/lib/catalog/variant-image";
import { FREE_BAG_PRODUCT_SLUGS } from "@/lib/catalog/free-bags";

export const dynamic = "force-dynamic";

const MAX_STYLES = 600;
const MAX_QUERY_LENGTH = 100;

/**
 * GET /api/products/styles?q=...&categoryId=...
 *
 * The till's grid: one entry per style, each with all its colours and sizes, so a card can be picked in one click and the
 * picker needs no second request. Read only, and a companion to /api/products (which lists single variants) and
 * /api/products/search (which resolves one scanned barcode); neither of those is changed. `q` matches the style name,
 * brand, any SKU of the style, or an exact barcode, and a matching style comes back with all of its variants.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, MAX_QUERY_LENGTH) ?? "";
    const categoryId = request.nextUrl.searchParams.get("categoryId") ?? undefined;

    const searchMatch: Prisma.ProductWhereInput[] = q
      ? [
          { name: { contains: q, mode: "insensitive" } },
          { nameTh: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { variants: { some: { OR: [{ barcode: q }, { sku: { contains: q, mode: "insensitive" } }] } } },
        ]
      : [];

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        // The free bags are added from the bag selector in the cart, not from the grid.
        slug: { notIn: FREE_BAG_PRODUCT_SLUGS },
        variants: { some: { isActive: true } },
        ...(categoryId ? { categoryId } : {}),
        ...(searchMatch.length > 0 ? { OR: searchMatch } : {}),
      },
      select: {
        id: true,
        name: true,
        nameTh: true,
        brand: true,
        imageUrl: true,
        promoTag: true,
        categoryId: true,
        colorImages: { select: { colorId: true, imageUrl: true } },
        variants: {
          where: { isActive: true },
          select: { id: true, sku: true, barcode: true, size: true, color: true, colorId: true, price: true, stockQuantity: true },
          orderBy: [{ color: "asc" }, { size: "asc" }],
        },
      },
      orderBy: { name: "asc" },
      take: MAX_STYLES,
    });

    const body: { styles: StyleSummary[] } = {
      styles: products.map((product) => ({
        id: product.id,
        name: product.name,
        nameTh: product.nameTh,
        brand: product.brand,
        imageUrl: product.imageUrl,
        promoTag: product.promoTag,
        categoryId: product.categoryId,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          barcode: variant.barcode,
          size: variant.size,
          colorId: variant.colorId,
          color: variant.color,
          price: formatMoney(variant.price),
          stockQuantity: variant.stockQuantity,
          imageUrl: variantImageUrl(product, variant.colorId),
        })),
      })),
    };

    return Response.json(body);
  } catch (err) {
    console.error("[GET /api/products/styles]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not load products.");
  }
}
