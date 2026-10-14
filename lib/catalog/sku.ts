import { getStorageConfig, isManagedImageUrl } from "@/lib/storage";

/** Readable default SKU, e.g. "CLASSI-BLU-M". Staff can type their own instead. */
export function defaultSku(name: string, color: string, size: string): string {
  const clean = (text: string, max: number) => text.replace(/[^A-Za-z0-9]/g, "").slice(0, max).toUpperCase();
  return `${clean(name, 6) || "PRD"}-${clean(color, 3) || "CLR"}-${clean(size, 6) || "SZ"}`;
}

const IMAGE_PATH_PATTERN = /^products\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export class ImageBindingError extends Error {}

/**
 * Checks that a product photo reference points at our own bucket, so a product can never be
 * bound to an arbitrary external URL. Returns the pair to store.
 */
export function validateImageBinding(imageUrl: string, imagePath: string): { imageUrl: string; imagePath: string } {
  const config = getStorageConfig();
  if (!config) throw new ImageBindingError("Image storage is not configured.");
  if (!IMAGE_PATH_PATTERN.test(imagePath)) throw new ImageBindingError("The image path is not valid.");
  if (!isManagedImageUrl(config, imageUrl) || !imageUrl.endsWith(imagePath)) {
    throw new ImageBindingError("The image must be uploaded through the product form.");
  }
  return { imageUrl, imagePath };
}
