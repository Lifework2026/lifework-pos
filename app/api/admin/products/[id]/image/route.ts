import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { readImageUpload } from "@/lib/image-upload";
import { prisma } from "@/lib/prisma";
import {
  ProductImageNotFound,
  removeProductImage,
  replaceProductImage,
  type ProductImageDb,
  type ProductImageStore,
} from "@/lib/product-image-binding";
import { deleteProductImage, getStorageConfig, StorageError, uploadProductImage, type StorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

const db: ProductImageDb = {
  find: (id) => prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true, imagePath: true } }),
  save: async (id, image) => {
    await prisma.product.update({ where: { id }, data: { imageUrl: image?.url ?? null, imagePath: image?.path ?? null } });
  },
};

function storeFor(config: StorageConfig | null): ProductImageStore {
  return {
    upload: async (bytes, image) => {
      if (!config) throw new StorageError("NOT_CONFIGURED", "Image storage is not set up.");
      return uploadProductImage(config, bytes, image);
    },
    remove: async (path) => {
      if (config) await deleteProductImage(config, path);
    },
  };
}

function failure(err: unknown, label: string): Response {
  if (err instanceof ProductImageNotFound) return apiError(404, "NOT_FOUND", "Product not found.");
  if (err instanceof StorageError) {
    console.error(label, err.code, err.message);
    return apiError(502, err.code, "The photo could not be saved to storage. Check the storage settings and try again.");
  }
  console.error(label, err);
  return apiError(500, "INTERNAL_ERROR", "The photo could not be saved.");
}

/**
 * POST /api/admin/products/[id]/image (multipart form, field "file")
 *
 * Uploads the photo to Supabase Storage and saves its public address on the product in the same request. If the
 * database save fails, the uploaded file is deleted again. The old photo is deleted after the new one is saved.
 * Managers only.
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
    return failure(err, "[POST /api/admin/products/[id]/image]");
  }
}

/** DELETE /api/admin/products/[id]/image: clears the photo from the product and deletes the file. Managers only. */
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
    return failure(err, "[DELETE /api/admin/products/[id]/image]");
  }
}
