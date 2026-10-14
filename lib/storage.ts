/**
 * Supabase Storage client for product photos, over the REST API (no SDK needed).
 * Server-side only: it uses the service-role key, which must never reach the browser.
 *
 * Required environment variables:
 *   SUPABASE_URL                 e.g. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    Project Settings > API > service_role
 * Optional:
 *   SUPABASE_STORAGE_BUCKET      defaults to "product-images"
 */

import { randomUUID } from "crypto";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type DetectedImage } from "@/lib/image-type";

export interface StorageConfig {
  url: string;
  key: string;
  bucket: string;
}

export class StorageError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "UPLOAD_FAILED" | "BUCKET_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Reads the storage settings, or null when they are not set. */
export function getStorageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const url = (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return { url, key, bucket: (env.SUPABASE_STORAGE_BUCKET ?? "product-images").trim() || "product-images" };
}

function authHeaders(config: StorageConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.key}`, apikey: config.key };
}

/** Public address of an object. The bucket is public-read, so product photos load without signing. */
export function publicUrl(config: StorageConfig, path: string): string {
  return `${config.url}/storage/v1/object/public/${config.bucket}/${path}`;
}

/** True only for URLs inside our own bucket, so a product cannot point at an arbitrary external image. */
export function isManagedImageUrl(config: StorageConfig, url: string): boolean {
  return url.startsWith(`${config.url}/storage/v1/object/public/${config.bucket}/`);
}

/** Creates the public bucket on first use. Safe to call repeatedly. */
export async function ensureBucket(config: StorageConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const existing = await fetchImpl(`${config.url}/storage/v1/bucket/${config.bucket}`, { headers: authHeaders(config) });
  if (existing.ok) return;
  if (existing.status !== 404 && existing.status !== 400) {
    throw new StorageError("BUCKET_FAILED", `Storage bucket check failed (HTTP ${existing.status}).`);
  }

  const created = await fetchImpl(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...authHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: config.bucket,
      name: config.bucket,
      public: true,
      file_size_limit: MAX_IMAGE_BYTES,
      allowed_mime_types: [...ALLOWED_IMAGE_TYPES],
    }),
  });
  // 409 means another request created it first.
  if (!created.ok && created.status !== 409) {
    throw new StorageError("BUCKET_FAILED", `Could not create the storage bucket (HTTP ${created.status}).`);
  }
}

/** Uploads one image and returns its path and public URL. */
export async function uploadProductImage(
  config: StorageConfig,
  bytes: Uint8Array,
  image: DetectedImage,
  fetchImpl: typeof fetch = fetch,
): Promise<{ path: string; url: string }> {
  const path = `products/${randomUUID()}.${image.ext}`;
  const upload = () =>
    fetchImpl(`${config.url}/storage/v1/object/${config.bucket}/${path}`, {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": image.mime, "Cache-Control": "max-age=31536000", "x-upsert": "false" },
      body: bytes as unknown as BodyInit,
    });

  let response = await upload();
  if (!response.ok && (response.status === 404 || response.status === 400)) {
    // The bucket may not exist yet. Create it, then retry once.
    await ensureBucket(config, fetchImpl);
    response = await upload();
  }
  if (!response.ok) {
    throw new StorageError("UPLOAD_FAILED", `Upload failed (HTTP ${response.status}).`);
  }
  return { path, url: publicUrl(config, path) };
}

/** Deletes an object. Best effort: a missing file is not an error. */
export async function deleteProductImage(config: StorageConfig, path: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${config.url}/storage/v1/object/${config.bucket}`, {
      method: "DELETE",
      headers: { ...authHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
  } catch {
    // Orphaned files are harmless. Never fail a product update because of cleanup.
  }
}
