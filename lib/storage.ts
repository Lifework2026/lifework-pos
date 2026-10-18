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

export interface StorageCheckStep {
  name: string;
  ok: boolean;
  /** What was found, in plain words. Never contains the key. */
  detail: string;
}

export interface StorageCheck {
  ok: boolean;
  steps: StorageCheckStep[];
  /** The first thing to fix, or a line saying everything works. */
  hint: string;
}

/** The role and project named inside a Supabase key (a JWT), without verifying it. Null when it is not shaped like one. */
function readKey(key: string): { role: string | null; ref: string | null } | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown; ref?: unknown };
    return { role: typeof payload.role === "string" ? payload.role : null, ref: typeof payload.ref === "string" ? payload.ref : null };
  } catch {
    return null;
  }
}

/**
 * Checks the storage settings one step at a time and says what is wrong, without ever showing the key: the settings
 * are readable and sensible, the bucket answers, and a small test file can be written and removed. Used by the
 * back office storage check, so a failure on the live site can be understood without reading the server log.
 */
export async function checkStorage(config: StorageConfig | null, fetchImpl: typeof fetch = fetch): Promise<StorageCheck> {
  const steps: StorageCheckStep[] = [];
  const finish = (hint: string): StorageCheck => ({ ok: steps.every((step) => step.ok), steps, hint });

  if (!config) {
    steps.push({ name: "settings", ok: false, detail: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on this server." });
    return finish("Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the environment, then redeploy.");
  }

  let host = "";
  try {
    const parsed = new URL(config.url);
    host = parsed.hostname;
    const looksRight = parsed.protocol === "https:" && parsed.pathname === "/" && host.endsWith(".supabase.co");
    steps.push({ name: "url", ok: looksRight, detail: looksRight ? `SUPABASE_URL points at ${host}.` : `SUPABASE_URL is "${config.url}". It should look like https://<project>.supabase.co with nothing after it.` });
  } catch {
    steps.push({ name: "url", ok: false, detail: "SUPABASE_URL is not a valid address. It should look like https://<project>.supabase.co." });
  }

  const key = readKey(config.key);
  const stray = /[\s"'\[\]]/.test(config.key);
  if (stray) {
    steps.push({ name: "key", ok: false, detail: "The service-role key has a space, quote or square bracket inside it. Paste the bare key, without [ ] or quotation marks." });
  } else if (!key) {
    steps.push({ name: "key", ok: false, detail: "The service-role key is not shaped like a Supabase key (three parts separated by dots). It may be cut off or the wrong value." });
  } else if (key.role !== "service_role") {
    steps.push({ name: "key", ok: false, detail: `The key is a "${key.role ?? "unknown"}" key. Uploads need the service_role key (Project Settings > API).` });
  } else if (host && key.ref && !host.startsWith(`${key.ref}.`)) {
    steps.push({ name: "key", ok: false, detail: `The key belongs to project ${key.ref}, but SUPABASE_URL points at ${host}.` });
  } else {
    steps.push({ name: "key", ok: true, detail: "The key is a service_role key for the same project as SUPABASE_URL." });
  }

  try {
    const bucket = await fetchImpl(`${config.url}/storage/v1/bucket/${config.bucket}`, { headers: authHeaders(config) });
    if (bucket.ok) steps.push({ name: "bucket", ok: true, detail: `The bucket "${config.bucket}" exists.` });
    else if (bucket.status === 404 || bucket.status === 400) steps.push({ name: "bucket", ok: false, detail: `The bucket "${config.bucket}" was not found (HTTP ${bucket.status}). It is created on the first upload, or run supabase/storage-product-images.sql.` });
    else steps.push({ name: "bucket", ok: false, detail: `Storage refused the key (HTTP ${bucket.status}).` });
  } catch {
    steps.push({ name: "bucket", ok: false, detail: "Storage could not be reached from this server." });
  }

  // A one-pixel PNG, written and removed again.
  const pixel = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const path = `diagnostics/${randomUUID()}.png`;
  try {
    const upload = await fetchImpl(`${config.url}/storage/v1/object/${config.bucket}/${path}`, {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": "image/png", "x-upsert": "false" },
      body: pixel as unknown as BodyInit,
    });
    steps.push({ name: "write", ok: upload.ok, detail: upload.ok ? "A test file was written to the bucket." : `A test file could not be written (HTTP ${upload.status}).` });
    if (upload.ok) await deleteProductImage(config, path, fetchImpl);
  } catch {
    steps.push({ name: "write", ok: false, detail: "A test file could not be written: storage could not be reached." });
  }

  const failed = steps.find((step) => !step.ok);
  return finish(failed ? failed.detail : "Storage works: the settings are right and a test file was written and removed.");
}
