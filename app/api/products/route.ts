import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, formatMoney } from "@/lib/api";
import type { VariantSummary } from "@/lib/pos-types";
import { variantImageUrl } from "@/lib/catalog/variant-image";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 200;
const MAX_QUERY_LENGTH = 100;

/**
 * GET /api/products?q=...&categoryId=...
 *
 * Lists active sellable variants for the manual product grid. `q` matches
 * product name, brand, SKU or an exact barcode.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, MAX_QUERY_LENGTH) ?? "";
    const categoryId = request.nextUrl.searchParams.get("categoryId") ?? undefined;

    const searchMatch: Prisma.ProductVariantWhereInput[] = q
      ? [
          { barcode: q },
          { sku: { contains: q, mode: "insensitive" } },
          { product: { name: { contains: q, mode: "insensitive" } } },
          { product: { brand: { contains: q, mode: "insensitive" } } },
        ]
      : [];

    const variants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        product: {
          isActive: true,
          ...(categoryId ? { categoryId } : {}),
        },
        ...(searchMatch.length > 0 ? { OR: searchMatch } : {}),
      },
      select: {
        id: true,
        sku: true,
        barcode: true,
        size: true,
        color: true,
        colorId: true,
        price: true,
        stockQuantity: true,
        product: {
          select: { id: true, name: true, nameTh: true, imageUrl: true, colorImages: { select: { colorId: true, imageUrl: true } }, promoTag: true, brand: true, categoryId: true },
        },
      },
      orderBy: [{ product: { name: "asc" } }, { color: "asc" }, { size: "asc" }],
      take: MAX_RESULTS,
    });

    const body: { variants: VariantSummary[] } = {
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        size: v.size,
        color: v.color,
        price: formatMoney(v.price),
        stockQuantity: v.stockQuantity,
        product: {
          id: v.product.id,
          name: v.product.name,
          brand: v.product.brand,
          nameTh: v.product.nameTh,
          imageUrl: variantImageUrl(v.product, v.colorId),
          promoTag: v.product.promoTag,
          categoryId: v.product.categoryId,
        },
      })),
    };

    return Response.json(body);
  } catch (err) {
    console.error("[GET /api/products]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not load products.");
  }
}
