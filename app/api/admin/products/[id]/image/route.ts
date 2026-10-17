import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { readImageUpload } from "@/lib/image-upload";
import { prisma } from "@/lib/prisma";
import { removeProductImage, replaceProductImage, type ProductImageDb } from "@/lib/product-image-binding";
import { imageFailure, storeFor } from "@/lib/product-image-store";
import { getStorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

const db: ProductImageDb = {
  find: (id) => prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true, imagePath: true } }),
  save: async (id, image) => {
    await prisma.product.update({ where: { id }, data: { imageUrl: image?.url ?? null, imagePath: image?.path ?? null } });
  },
};

/**
 * POST /api/admin/products/[id]/image (multipart form, field "file")
 *
 * Uploads the product photo to Supabase Storage and saves its public address on the product in the same request. This
 * is the photo every colour shows until the colour has its own (see .../colors/[colorId]/image). If the database save
 * fails, the uploaded file is deleted again. The old photo is deleted after the new one is saved. Managers only.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
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
    const saved = await replaceProductImage(db, storeFor(config), params.id, upload.bytes, upload.image);
    await prisma.auditLog.create({
      data: { action: "PRODUCT_IMAGE_SET", entityType: "Product", entityId: params.id, userId: auth.user.id, details: { path: saved.path } },
    });
    return Response.json({ url: saved.url, path: saved.path }, { status: 201 });
  } catch (err) {
    return imageFailure(err, "[POST /api/admin/products/[id]/image]");
  }
}

/** DELETE /api/admin/products/[id]/image: clears the product photo and deletes the file. Managers only. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  try {
    await removeProductImage(db, storeFor(getStorageConfig()), params.id);
    await prisma.auditLog.create({
      data: { action: "PRODUCT_IMAGE_REMOVED", entityType: "Product", entityId: params.id, userId: auth.user.id },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return imageFailure(err, "[DELETE /api/admin/products/[id]/image]");
  }
}
