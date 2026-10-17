import { apiError } from "@/lib/api";
import { detectImageType, MAX_IMAGE_BYTES, type DetectedImage } from "@/lib/image-type";

/**
 * Reads and checks a photo sent as multipart form data (field "file"). Used by both photo routes, so a photo is
 * checked the same way whether the product exists yet or not. The type is read from the bytes, not from the name.
 */
export async function readImageUpload(request: Request): Promise<{ bytes: Uint8Array; image: DetectedImage } | { response: Response }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { response: apiError(400, "INVALID_FORM", "Send the photo as multipart form data.") };
  }

  const file = form.get("file");
  if (!(file instanceof File)) return { response: apiError(400, "FILE_REQUIRED", "Choose a photo to upload.") };
  if (file.size === 0) return { response: apiError(400, "FILE_EMPTY", "The photo is empty.") };
  if (file.size > MAX_IMAGE_BYTES) {
    return { response: apiError(413, "FILE_TOO_LARGE", `The photo is larger than ${Math.round(MAX_IMAGE_BYTES / 1000)} KB.`) };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImageType(bytes);
  if (!image) return { response: apiError(415, "UNSUPPORTED_TYPE", "Only JPEG, PNG and WebP photos are accepted.") };
  return { bytes, image };
}
