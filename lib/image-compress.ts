import { MAX_IMAGE_BYTES } from "@/lib/image-type";

/**
 * Making a product photo small enough to store. Client-safe and pure: the browser supplies the encoder.
 *
 * Storage on the free plan is 1 GB, and a catalogue can hold thousands of colours, so every photo is shrunk before it
 * is uploaded: at most 800 px on the long side, encoded as WebP, and under 150 KB. The search tries the best quality
 * first and gives up quality in steps; if that is not enough it makes the picture smaller and tries again.
 */

/** What the browser aims for. A little below the hard limit (MAX_IMAGE_BYTES), so a file never sits on the edge. */
export const TARGET_IMAGE_BYTES = MAX_IMAGE_BYTES - 5_000;
/** The long side of the picture, in pixels. */
export const MAX_SIDE_PX = 800;
/** The picture is not made smaller than this on the long side. Below it the photo is not useful on the till. */
export const MIN_SIDE_PX = 320;

const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34] as const;
const SHRINK_FACTOR = 0.85;

export type CompressionFailure = "UNREADABLE" | "TOO_COMPLEX" | "ENCODE_FAILED";

export class PhotoCompressionError extends Error {
  constructor(
    public readonly code: CompressionFailure,
    message: string,
  ) {
    super(message);
    this.name = "PhotoCompressionError";
  }
}

/** The largest size that fits inside a square of maxSide pixels, keeping the proportions. Never enlarges. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface Encoded {
  size: number;
  type: string;
}

export interface Compressed<T extends Encoded> {
  encoded: T;
  width: number;
  height: number;
  quality: number;
}

export interface CompressionLimits {
  targetBytes?: number;
  maxSide?: number;
  minSide?: number;
}

/**
 * Finds the best picture that fits: the first quality, from best to worst, whose file is within the target, at the
 * largest size that works. encode draws the picture at a size and returns the encoded file, or null if the browser
 * cannot encode. The result is never larger than the target, or this throws.
 */
export async function compressToTarget<T extends Encoded>(
  encode: (width: number, height: number, quality: number) => Promise<T | null>,
  source: { width: number; height: number },
  limits: CompressionLimits = {},
): Promise<Compressed<T>> {
  const target = limits.targetBytes ?? TARGET_IMAGE_BYTES;
  const maxSide = limits.maxSide ?? MAX_SIDE_PX;
  const minSide = limits.minSide ?? MIN_SIDE_PX;

  let side = Math.min(maxSide, Math.max(source.width, source.height));
  for (;;) {
    const { width, height } = fitWithin(source.width, source.height, side);
    for (const quality of QUALITY_STEPS) {
      const encoded = await encode(width, height, quality);
      if (!encoded) throw new PhotoCompressionError("ENCODE_FAILED", "The browser could not encode the photo.");
      if (encoded.size <= target) return { encoded, width, height, quality };
    }
    const next = Math.floor(side * SHRINK_FACTOR);
    if (next < minSide) throw new PhotoCompressionError("TOO_COMPLEX", "The photo could not be made small enough.");
    side = next;
  }
}

/** 96 KB, 1.4 MB. Decimal units, as storage plans count them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
