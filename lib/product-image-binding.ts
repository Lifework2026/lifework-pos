import type { DetectedImage } from "@/lib/image-type";

/**
 * Saving a product photo is two steps in two systems: the file goes to storage, the address goes to the database.
 * This keeps them in step. The storage and the database are passed in, so the rules can be tested without either.
 *
 *   - The new file is uploaded first, then the address is saved. If the save fails, the new file is deleted again.
 *   - The old file is deleted only after the new address is saved, so a failure never leaves a product with no photo.
 *   - A failed cleanup leaves an unused file in storage. That is harmless and never fails the request.
 */

export interface StoredImage {
  url: string;
  path: string;
}

export interface ProductImageStore {
  upload(bytes: Uint8Array, image: DetectedImage): Promise<StoredImage>;
  remove(path: string): Promise<void>;
}

export interface ProductImageRecord {
  id: string;
  imageUrl: string | null;
  imagePath: string | null;
}

export interface ProductImageDb {
  find(productId: string): Promise<ProductImageRecord | null>;
  /** Saves the address of the photo, or clears it with null. */
  save(productId: string, image: StoredImage | null): Promise<void>;
}

export class ProductImageNotFound extends Error {
  constructor() {
    super("Product not found.");
    this.name = "ProductImageNotFound";
  }
}

async function removeQuietly(store: ProductImageStore, path: string): Promise<void> {
  try {
    await store.remove(path);
  } catch {
    // An unused file is harmless. Never fail the request over cleanup.
  }
}

/** Uploads a photo and saves its address on the product in one step. Returns the stored photo. */
export async function replaceProductImage(
  db: ProductImageDb,
  store: ProductImageStore,
  productId: string,
  bytes: Uint8Array,
  image: DetectedImage,
): Promise<StoredImage> {
  const product = await db.find(productId);
  if (!product) throw new ProductImageNotFound();

  const stored = await store.upload(bytes, image);
  try {
    await db.save(productId, stored);
  } catch (err) {
    await removeQuietly(store, stored.path);
    throw err;
  }
  if (product.imagePath && product.imagePath !== stored.path) await removeQuietly(store, product.imagePath);
  return stored;
}

/** Clears the photo from the product, then deletes the file. */
export async function removeProductImage(db: ProductImageDb, store: ProductImageStore, productId: string): Promise<void> {
  const product = await db.find(productId);
  if (!product) throw new ProductImageNotFound();
  await db.save(productId, null);
  if (product.imagePath) await removeQuietly(store, product.imagePath);
}
