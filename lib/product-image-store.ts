import { apiError } from "@/lib/api";
import { ProductImageNotFound, type ProductImageStore } from "@/lib/product-image-binding";
import { deleteProductImage, StorageError, uploadProductImage, type StorageConfig } from "@/lib/storage";

/** The photo routes' link to Supabase Storage. With no configuration, uploads fail clearly and cleanup does nothing. */
export function storeFor(config: StorageConfig | null): ProductImageStore {
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

/** The response for a failed photo request. The detail goes to the log, never to the browser. */
export function imageFailure(err: unknown, label: string): Response {
  if (err instanceof ProductImageNotFound) return apiError(404, "NOT_FOUND", "Product or colour not found.");
  if (err instanceof StorageError) {
    console.error(label, err.code, err.message);
    return apiError(502, err.code, "The photo could not be saved to storage. Check the storage settings and try again.");
  }
  console.error(label, err);
  return apiError(500, "INTERNAL_ERROR", "The photo could not be saved.");
}
