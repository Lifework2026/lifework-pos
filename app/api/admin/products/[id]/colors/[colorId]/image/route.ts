import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { readImageUpload } from "@/lib/image-upload";
import { prisma } from "@/lib/prisma";
import { removeProductImage, replaceProductImage, type ProductImageDb } from "@/lib/product-image-binding";
import { imageFailure, storeFor } from "@/lib/product-image-store";
import { getStorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * The colour photo of one product, as the shared photo logic sees it. The colour must be one the product is sold in;
 * a colour the product does not use is reported as not found, so a photo can never attach to an unrelated colour.
 */
function colourPhotoDb(productId: string, colorId: string): ProductImageDb {
  const key = { productId_colorId: { productId, colorId } };
  return {
    find: async () => {
      const sold = await prisma.productVariant.count({ where: { productId, colorId } });
      if (sold === 0) return null;
      const row = await prisma.productColorImage.findUnique({ where: key, select: { imageUrl: true, imagePath: true } });
      return { id: productId, imageUrl: row?.imageUrl ?? null, imagePath: row?.imagePath ?? null };
    },
    save: async (_id, image) => {
      if (image) {
        await prisma.productColorImage.upsert({
          where: key,
          create: { productId, colorId, imageUrl: image.url, imagePath: image.path },
          update: { imageUrl: image.url, imagePath: image.path },
        });
      } else {
        await prisma.productColorImage.deleteMany({ where: { productId, colorId } });
      }
    },
  };
}

type Params = { params: { id: string; colorId: string } };

/**
 * POST /api/admin/products/[id]/colors/[colorId]/image (multipart form, field "file")
 *
 * The photo for one colour of a product. Every size in that colour shares it. It is uploaded and its address saved in
 * one request, and the uploaded file is deleted again if the save fails. Managers only.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const config = getStorageConfig();
  if (!config) {
    return apiError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Image storage is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the environment, then redeploy.",
    );
  }

  const upload = await readImageUpload(request);
  if ("response" in upload) return upload.response;

  try {
    const saved = await replaceProductImage(colourPhotoDb(params.id, params.colorId), storeFor(config), params.id, upload.bytes, upload.image);
    await prisma.auditLog.create({
      data: {
        action: "PRODUCT_COLOR_IMAGE_SET",
        entityType: "Product",
        entityId: params.id,
        userId: auth.user.id,
        details: { colorId: params.colorId, path: saved.path },
      },
    });
    return Response.json({ url: saved.url, path: saved.path }, { status: 201 });
  } catch (err) {
    return imageFailure(err, "[POST /api/admin/products/[id]/colors/[colorId]/image]");
  }
}

/** DELETE /api/admin/products/[id]/colors/[colorId]/image: clears the colour photo and deletes the file. Managers only. */
export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  try {
    await removeProductImage(colourPhotoDb(params.id, params.colorId), storeFor(getStorageConfig()), params.id);
    await prisma.auditLog.create({
      data: {
        action: "PRODUCT_COLOR_IMAGE_REMOVED",
        entityType: "Product",
        entityId: params.id,
        userId: auth.user.id,
        details: { colorId: params.colorId },
      },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return imageFailure(err, "[DELETE /api/admin/products/[id]/colors/[colorId]/image]");
  }
}
