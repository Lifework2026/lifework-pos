import { createHash } from "crypto";

/**
 * URL-safe identifier from a name. Latin letters and digits are kept; anything else (including Thai)
 * collapses to dashes. A name with no Latin characters gets a short stable hash, so two Thai names
 * never collide on an empty slug.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug.slice(0, 80);
  const hash = createHash("sha1").update(value.trim().toLowerCase()).digest("hex").slice(0, 8);
  return `item-${hash}`;
}
