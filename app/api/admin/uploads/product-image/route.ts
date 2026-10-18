import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { readImageUpload } from "@/lib/image-upload";
import { getStorageConfig, StorageError, uploadProductImage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/uploads/product-image (multipart form, field "file")
 *
 * Stores a product photo in Supabase Storage and returns its public URL and path. The photo is bound
 * to a product afterwards, when the product form is saved. Managers only (enforced by middleware).
 */
export async function POST(request: Request): Promise<Response> {
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
  const { bytes, image } = upload;

  try {
    const stored = await uploadProductImage(config, bytes, image);
    return Response.json({ url: stored.url, path: stored.path }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageError) {
      console.error("[POST /api/admin/uploads/product-image]", err.code, err.message);
      return apiError(502, err.code, `The photo could not be saved to storage. ${err.message} Open /api/admin/storage-check while signed in to see what is wrong.`);
    }
    console.error("[POST /api/admin/uploads/product-image]", err);
    return apiError(500, "INTERNAL_ERROR", "The photo could not be uploaded.");
  }
}
