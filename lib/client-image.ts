/** Browser-only image helpers for product photos. */
import { compressToTarget, PhotoCompressionError } from "@/lib/image-compress";

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoCompressionError("UNREADABLE", "The file is not a readable image."));
    };
    image.src = url;
  });
}

export interface PreparedPhoto {
  file: File;
  fromBytes: number;
  toBytes: number;
}

/**
 * Shrinks every photo before it is uploaded: at most 800 px on the long side, WebP, under 150 KB (JPEG only in a
 * browser that cannot encode WebP). Phone photos are often 4-8 MB, and the free storage plan holds 1 GB. Transparent
 * areas become white. Even a small photo is re-encoded, so every stored file follows the same rules.
 */
export async function prepareProductPhoto(file: File): Promise<PreparedPhoto> {
  const image = await loadImage(file);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoCompressionError("ENCODE_FAILED", "The browser cannot draw the photo.");

  let mime = "image/webp";
  const encode = async (width: number, height: number, quality: number): Promise<Blob | null> => {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    // A browser that cannot encode WebP quietly returns PNG, which is far too large. Use JPEG instead.
    if (blob && mime === "image/webp" && blob.type !== "image/webp") {
      mime = "image/jpeg";
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    }
    return blob;
  };

  const { encoded } = await compressToTarget(encode, { width: image.naturalWidth, height: image.naturalHeight });
  const extension = encoded.type === "image/webp" ? "webp" : "jpg";
  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return { file: new File([encoded], `${name}.${extension}`, { type: encoded.type }), fromBytes: file.size, toBytes: encoded.size };
}
