import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";
import { randomStoreEan13 } from "@/lib/barcode";
import { BARCODE_RULE_MESSAGE, isValidBarcode } from "@/lib/barcode-rules";
import { defaultSku, ImageBindingError, validateImageBinding } from "@/lib/catalog/sku";
import { ensureSizes } from "@/lib/catalog/sizes";
import { colorNamesById } from "@/lib/master-data";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

const variantSchema = z.object({
  size: z.string().trim().min(1).max(20),
  /** The colour master record. Required. */
  colorId: z.string().min(1, "Choose a colour.").max(64),
  sku: z.string().trim().min(1).max(40).optional().nullable(),
  barcode: z.string().trim().refine(isValidBarcode, BARCODE_RULE_MESSAGE).optional().nullable(),
  price: z.number().positive().max(1_000_000),
  cost: z.number().nonnegative().max(1_000_000).nullable().optional(),
  initialStock: z.number().int().min(0).max(100_000),
});

const productSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    nameTh: z.string().trim().max(150).optional().nullable(),
    brand: z.string().trim().max(80).optional().nullable(),
    promoTag: z.string().trim().max(30).optional().nullable(),
    description: z.string().trim().max(2000).optional().nullable(),
    categoryId: z.string().min(1),
    imageUrl: z.string().max(500).optional().nullable(),
    imagePath: z.string().max(200).optional().nullable(),
    variants: z.array(variantSchema).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.variants.forEach((variant, index) => {
      const key = `${variant.size.toLowerCase()}|${variant.colorId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Size ${variant.size} is listed twice in the same colour.`,
          path: ["variants", index],
        });
      }
      seen.add(key);
    });
  });

class ProductError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ProductError";
  }
}

/** POST /api/admin/products: creates a product, its variants and any opening stock in one transaction. */
export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, productSchema);
  if ("response" in body) return body.response;
  const input = body.data;

  try {
    const category = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw new ProductError(400, "CATEGORY_NOT_FOUND", "Choose a valid category.");

    let image: { imageUrl: string; imagePath: string } | null = null;
    if (input.imageUrl || input.imagePath) {
      if (!input.imageUrl || !input.imagePath) throw new ProductError(400, "IMAGE_INVALID", "The photo reference is incomplete.");
      try {
        image = validateImageBinding(input.imageUrl, input.imagePath);
      } catch (err) {
        if (err instanceof ImageBindingError) throw new ProductError(400, "IMAGE_INVALID", err.message);
        throw err;
      }
    }

    // Unique slug: "classic-shirt", then "classic-shirt-2", and so on.
    const baseSlug = slugify(input.name);
    const similar = await prisma.product.findMany({ where: { slug: { startsWith: baseSlug } }, select: { slug: true } });
    const taken = new Set(similar.map((row) => row.slug));
    let slug = baseSlug;
    for (let n = 2; taken.has(slug); n += 1) slug = `${baseSlug}-${n}`;

    // Colours come from the master data. An id that is not in the list is refused, never invented.
    const colorNames = await colorNamesById(prisma, input.variants.map((variant) => variant.colorId));
    for (const variant of input.variants) {
      if (!colorNames.has(variant.colorId)) throw new ProductError(400, "COLOR_NOT_FOUND", "Choose a colour from the list.");
    }

    const resolved = input.variants.map((variant) => {
      const colorName = colorNames.get(variant.colorId) ?? "";
      return {
        size: variant.size,
        color: colorName,
        colorId: variant.colorId,
        price: variant.price,
        cost: variant.cost ?? null,
        initialStock: variant.initialStock,
        sku: variant.sku ? variant.sku.toUpperCase() : defaultSku(input.name, colorName, variant.size),
        barcode: variant.barcode ?? randomStoreEan13(),
      };
    });

    const skus = resolved.map((variant) => variant.sku);
    const barcodes = resolved.map((variant) => variant.barcode);
    if (new Set(skus).size !== skus.length) throw new ProductError(400, "DUPLICATE_SKU", "Two variants use the same SKU.");
    if (new Set(barcodes).size !== barcodes.length) throw new ProductError(400, "DUPLICATE_BARCODE", "Two variants use the same barcode.");

    const conflicts = await prisma.productVariant.findMany({
      where: { OR: [{ sku: { in: skus } }, { barcode: { in: barcodes } }] },
      select: { sku: true, barcode: true },
    });
    if (conflicts.length > 0) {
      throw new ProductError(409, "SKU_OR_BARCODE_EXISTS", "Some SKUs or barcodes are already in use.", {
        skus: conflicts.map((row) => row.sku),
        barcodes: conflicts.map((row) => row.barcode),
      });
    }

    const product = await prisma.$transaction(
      async (tx) => {
        await ensureSizes(tx, resolved.map((variant) => variant.size));
        const created = await tx.product.create({
          data: {
            name: input.name,
            nameTh: input.nameTh || null,
            slug,
            brand: input.brand || null,
            promoTag: input.promoTag || null,
            description: input.description || null,
            categoryId: input.categoryId,
            imageUrl: image?.imageUrl ?? null,
            imagePath: image?.imagePath ?? null,
            variants: {
              create: resolved.map((variant) => ({
                size: variant.size,
                color: variant.color,
                colorId: variant.colorId,
                sku: variant.sku,
                barcode: variant.barcode,
                price: variant.price,
                cost: variant.cost ?? null,
                stockQuantity: variant.initialStock,
              })),
            },
          },
          select: {
            id: true,
            slug: true,
            name: true,
            variants: { select: { id: true, sku: true, stockQuantity: true } },
          },
        });

        const stocked = created.variants.filter((variant) => variant.stockQuantity > 0);
        if (stocked.length > 0) {
          await tx.inventoryMovement.createMany({
            data: stocked.map((variant) => ({
              variantId: variant.id,
              type: "STOCK_IN",
              quantityChange: variant.stockQuantity,
              stockBefore: 0,
              stockAfter: variant.stockQuantity,
              reference: created.slug,
              note: "Opening stock",
              userId: auth.user.id,
            })),
          });
        }
        return created;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );

    return Response.json({ product }, { status: 201 });
  } catch (err) {
    if (err instanceof ProductError) return apiError(err.status, err.code, err.message, err.details);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "SKU_OR_BARCODE_EXISTS", "That SKU or barcode is already in use. Please try again.");
    }
    console.error("[POST /api/admin/products]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not create the product. Nothing was saved.");
  }
}
