import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { detectImageType, MAX_IMAGE_BYTES } from "@/lib/image-type";
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "INVALID_FORM", "Send the photo as multipart form data.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "FILE_REQUIRED", "Choose a photo to upload.");
  if (file.size === 0) return apiError(400, "FILE_EMPTY", "The photo is empty.");
  if (file.size > MAX_IMAGE_BYTES) {
    return apiError(413, "FILE_TOO_LARGE", `The photo is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImageType(bytes);
  if (!image) return apiError(415, "UNSUPPORTED_TYPE", "Only JPEG, PNG and WebP photos are accepted.");

  try {
    const stored = await uploadProductImage(config, bytes, image);
    return Response.json({ url: stored.url, path: stored.path }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageError) {
      console.error("[POST /api/admin/uploads/product-image]", err.code, err.message);
      return apiError(502, err.code, "The photo could not be saved to storage. Check the storage settings and try again.");
    }
    console.error("[POST /api/admin/uploads/product-image]", err);
    return apiError(500, "INTERNAL_ERROR", "The photo could not be uploaded.");
  }
}
