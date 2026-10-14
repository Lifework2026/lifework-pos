/** Browser-only image helpers for product photos. */

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.85;
/** Photos already this small and within the size limit are uploaded untouched. */
const SKIP_RESIZE_BELOW_BYTES = 250 * 1024;

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
      reject(new Error("The file is not a readable image."));
    };
    image.src = url;
  });
}

/**
 * Shrinks a photo to at most 1200 px on the long side and re-encodes it as JPEG. Phone photos are
 * often 4-8 MB, which is slow to upload and over the server's limit. Transparent areas become white.
 */
export async function prepareProductPhoto(file: File): Promise<File> {
  if (file.size <= SKIP_RESIZE_BELOW_BYTES && file.type === "image/jpeg") return file;

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) return file;
  // Keep the original if re-encoding somehow made it larger.
  if (blob.size >= file.size && file.type === "image/jpeg") return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
