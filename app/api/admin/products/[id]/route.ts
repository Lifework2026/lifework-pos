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
import { getStorageConfig, deleteProductImage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const variantPatchSchema = z.object({
  /** Present for an existing variant, absent for a new one. */
  id: z.string().min(1).max(64).optional(),
  size: z.string().trim().min(1).max(20),
  color: z.string().trim().min(1).max(40),
  sku: z.string().trim().min(1).max(40).optional().nullable(),
  barcode: z.string().trim().refine(isValidBarcode, BARCODE_RULE_MESSAGE).optional().nullable(),
  price: z.number().positive().max(1_000_000),
  isActive: z.boolean().optional(),
  /** New variants only. Existing stock changes go through the stock ledger. */
  initialStock: z.number().int().min(0).max(100_000).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  nameTh: z.string().trim().max(150).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  /** A new photo (both fields) or null to remove the current one. */
  imageUrl: z.string().max(500).nullable().optional(),
  imagePath: z.string().max(200).nullable().optional(),
  variants: z.array(variantPatchSchema).max(60).optional(),
});

class ProductError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductError";
  }
}

const priceOf = (value: Prisma.Decimal | number) => new Prisma.Decimal(value).toFixed(2);

/** PATCH /api/admin/products/[id]: edits a product and its variants. Price changes are recorded in the audit log. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, patchSchema);
  if ("response" in body) return body.response;
  const input = body.data;

  let oldImagePathToDelete: string | null = null;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: params.id },
          include: { variants: true },
        });
        if (!product) throw new ProductError(404, "PRODUCT_NOT_FOUND", "Product not found.");

        if (input.categoryId) {
          const category = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
          if (!category) throw new ProductError(400, "CATEGORY_NOT_FOUND", "Choose a valid category.");
        }

        // Photo: replace, remove, or leave alone.
        const productData: Prisma.ProductUpdateInput = {};
        if (input.imageUrl === null) {
          productData.imageUrl = null;
          productData.imagePath = null;
          oldImagePathToDelete = product.imagePath;
        } else if (typeof input.imageUrl === "string") {
          if (!input.imagePath) throw new ProductError(400, "IMAGE_INVALID", "The photo reference is incomplete.");
          try {
            const image = validateImageBinding(input.imageUrl, input.imagePath);
            if (image.imageUrl !== product.imageUrl) {
              productData.imageUrl = image.imageUrl;
              productData.imagePath = image.imagePath;
              oldImagePathToDelete = product.imagePath;
            }
          } catch (err) {
            if (err instanceof ImageBindingError) throw new ProductError(400, "IMAGE_INVALID", err.message);
            throw err;
          }
        }

        const changedFields: string[] = [];
        const setIfChanged = <K extends "name" | "nameTh" | "brand" | "description" | "categoryId" | "isActive">(
          key: K,
          next: unknown,
          current: unknown,
        ) => {
          if (next !== undefined && next !== current) {
            (productData as Record<string, unknown>)[key === "categoryId" ? "category" : key] =
              key === "categoryId" ? { connect: { id: next as string } } : next;
            changedFields.push(key);
          }
        };
        setIfChanged("name", input.name, product.name);
        setIfChanged("nameTh", input.nameTh === undefined ? undefined : input.nameTh || null, product.nameTh);
        setIfChanged("brand", input.brand === undefined ? undefined : input.brand || null, product.brand);
        setIfChanged("description", input.description === undefined ? undefined : input.description || null, product.description);
        setIfChanged("categoryId", input.categoryId, product.categoryId);
        setIfChanged("isActive", input.isActive, product.isActive);
        if (productData.imageUrl !== undefined) changedFields.push("image");

        // Variants.
        const byId = new Map(product.variants.map((variant) => [variant.id, variant]));
        const incoming = input.variants ?? [];
        for (const variant of incoming) {
          if (variant.id && !byId.has(variant.id)) {
            throw new ProductError(400, "VARIANT_NOT_FOUND", "A variant does not belong to this product.");
          }
        }

        // After the edit, every (size, color) pair on the product must still be unique.
        const finalPairs = new Map<string, string>();
        for (const variant of product.variants) {
          const edited = incoming.find((entry) => entry.id === variant.id);
          const size = edited?.size ?? variant.size;
          const color = edited?.color ?? variant.color;
          finalPairs.set(variant.id, `${size.toLowerCase()}|${color.toLowerCase()}`);
        }
        incoming.filter((entry) => !entry.id).forEach((entry, index) => finalPairs.set(`new-${index}`, `${entry.size.toLowerCase()}|${entry.color.toLowerCase()}`));
        if (new Set(finalPairs.values()).size !== finalPairs.size) {
          throw new ProductError(400, "DUPLICATE_VARIANT", "Two variants would have the same size and color.");
        }

        await ensureSizes(tx, incoming.map((variant) => variant.size));

        const priceChanges: { sku: string; from: string; to: string }[] = [];
        const movements: Prisma.InventoryMovementCreateManyInput[] = [];

        for (const variant of incoming) {
          if (variant.id) {
            const current = byId.get(variant.id);
            if (!current) continue;
            const data: Prisma.ProductVariantUpdateInput = {};
            if (variant.size !== current.size) data.size = variant.size;
            if (variant.color !== current.color) data.color = variant.color;
            if (variant.sku && variant.sku.toUpperCase() !== current.sku) data.sku = variant.sku.toUpperCase();
            if (variant.barcode && variant.barcode !== current.barcode) data.barcode = variant.barcode;
            if (priceOf(variant.price) !== priceOf(current.price)) {
              data.price = variant.price;
              priceChanges.push({ sku: current.sku, from: priceOf(current.price), to: priceOf(variant.price) });
            }
            if (variant.isActive !== undefined && variant.isActive !== current.isActive) data.isActive = variant.isActive;
            if (Object.keys(data).length > 0) {
              await tx.productVariant.update({ where: { id: current.id }, data });
              changedFields.push(`variant:${current.sku}`);
            }
          } else {
            const sku = variant.sku ? variant.sku.toUpperCase() : defaultSku(input.name ?? product.name, variant.color, variant.size);
            const stock = variant.initialStock ?? 0;
            const created = await tx.productVariant.create({
              data: {
                productId: product.id,
                size: variant.size,
                color: variant.color,
                sku,
                barcode: variant.barcode ?? randomStoreEan13(),
                price: variant.price,
                stockQuantity: stock,
              },
              select: { id: true },
            });
            changedFields.push(`new-variant:${sku}`);
            if (stock > 0) {
              movements.push({
                variantId: created.id,
                type: "STOCK_IN",
                quantityChange: stock,
                stockBefore: 0,
                stockAfter: stock,
                reference: product.slug,
                note: "Opening stock",
                userId: auth.user.id,
              });
            }
          }
        }
        if (movements.length > 0) await tx.inventoryMovement.createMany({ data: movements });

        if (Object.keys(productData).length > 0) {
          await tx.product.update({ where: { id: product.id }, data: productData });
        }

        if (changedFields.length > 0) {
          await tx.auditLog.create({
            data: {
              action: "PRODUCT_UPDATE",
              entityType: "Product",
              entityId: product.id,
              userId: auth.user.id,
              details: { name: product.name, changedFields, priceChanges },
            },
          });
        }
        return { id: product.id, changed: changedFields.length };
      },
      { maxWait: 5_000, timeout: 20_000 },
    );

    const config = getStorageConfig();
    if (config && oldImagePathToDelete) await deleteProductImage(config, oldImagePathToDelete);

    return Response.json({ product: result });
  } catch (err) {
    if (err instanceof ProductError) return apiError(err.status, err.code, err.message);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "SKU_OR_BARCODE_EXISTS", "That SKU, barcode, or size and color is already used by another variant.");
    }
    console.error("[PATCH /api/admin/products/[id]]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not save the product. Nothing was changed.");
  }
}

/** Movement notes written when a product is first created. A product with only these can be deleted outright. */
const CREATION_NOTES = new Set(["Opening stock", "Bulk import"]);

/**
 * DELETE /api/admin/products/[id]: removes a product that has never been sold or touched.
 * Anything with sales or a stock history is kept for the records, so it can only be deactivated.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  let imagePath: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: params.id },
        include: { variants: { select: { id: true, sku: true, stockQuantity: true } } },
      });
      if (!product) throw new ProductError(404, "PRODUCT_NOT_FOUND", "Product not found.");

      const variantIds = product.variants.map((variant) => variant.id);
      const [sold, movements] = await Promise.all([
        tx.orderItem.count({ where: { variantId: { in: variantIds } } }),
        tx.inventoryMovement.findMany({ where: { variantId: { in: variantIds } }, select: { type: true, note: true } }),
      ]);
      const onlyCreation = movements.every((movement) => movement.type === "STOCK_IN" && movement.note !== null && CREATION_NOTES.has(movement.note));
      if (sold > 0 || !onlyCreation) {
        throw new ProductError(409, "HAS_HISTORY", "This product has sales or stock history, so it is kept for the records. Deactivate it instead.");
      }

      imagePath = product.imagePath;
      await tx.inventoryMovement.deleteMany({ where: { variantId: { in: variantIds } } });
      await tx.productVariant.deleteMany({ where: { productId: product.id } });
      await tx.product.delete({ where: { id: product.id } });
      await tx.auditLog.create({
        data: {
          action: "PRODUCT_DELETE",
          entityType: "Product",
          entityId: product.id,
          userId: auth.user.id,
          details: { name: product.name, skus: product.variants.map((variant) => variant.sku) },
        },
      });
    });

    const config = getStorageConfig();
    if (config && imagePath) await deleteProductImage(config, imagePath);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ProductError) return apiError(err.status, err.code, err.message);
    console.error("[DELETE /api/admin/products/[id]]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not delete the product.");
  }
}
