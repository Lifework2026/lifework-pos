/** Product photo rules. Client-safe: only reads bytes, no Node APIs. */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface DetectedImage {
  mime: (typeof ALLOWED_IMAGE_TYPES)[number];
  ext: "jpg" | "png" | "webp";
}

/**
 * Identifies JPEG, PNG and WebP from the file's first bytes. The browser-supplied file name and
 * content type are not trusted, so a renamed script or document is rejected.
 */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((value, index) => bytes[index] === value)) {
    return { mime: "image/png", ext: "png" };
  }
  const ascii = (start: number, text: string) => text.split("").every((char, i) => bytes[start + i] === char.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}
