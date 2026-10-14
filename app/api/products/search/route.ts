import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, formatMoney } from "@/lib/api";
import type { VariantSummary } from "@/lib/pos-types";

export const dynamic = "force-dynamic";

const MAX_BARCODE_LENGTH = 64;

/**
 * GET /api/products/search?barcode=...
 *
 * Resolves a scanned barcode to a single sellable variant. Uses the unique
 * index on ProductVariant.barcode, so this is one indexed lookup.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const barcode = request.nextUrl.searchParams.get("barcode")?.trim() ?? "";

    if (barcode.length === 0) {
      return apiError(400, "BARCODE_REQUIRED", "Query parameter 'barcode' is required.");
    }
    if (barcode.length > MAX_BARCODE_LENGTH) {
      return apiError(400, "BARCODE_INVALID", "Barcode is too long.");
    }

    const variant = await prisma.productVariant.findUnique({
      where: { barcode },
      select: {
        id: true,
        sku: true,
        barcode: true,
        size: true,
        color: true,
        price: true,
        stockQuantity: true,
        isActive: true,
        product: {
          select: {
            id: true,
            name: true,
            brand: true,
            categoryId: true,
            isActive: true,
          },
        },
      },
    });

    if (!variant || !variant.isActive || !variant.product.isActive) {
      return apiError(404, "VARIANT_NOT_FOUND", `No active product found for barcode ${barcode}.`);
    }

    const body: { variant: VariantSummary } = {
      variant: {
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        price: formatMoney(variant.price),
        stockQuantity: variant.stockQuantity,
        product: {
          id: variant.product.id,
          name: variant.product.name,
          brand: variant.product.brand,
          categoryId: variant.product.categoryId,
        },
      },
    };

    return Response.json(body);
  } catch (err) {
    console.error("[GET /api/products/search]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not search for the product.");
  }
}
