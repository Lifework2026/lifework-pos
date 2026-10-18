/**
 * Saving one photo on a style or on one of its colours, with the audit line. Used by the photo scripts. The database and the
 * storage are passed in, and the upload-then-save-then-delete-old order is the one in product-image-binding.
 */
import type { PrismaClient } from "@prisma/client";
import { replaceProductImage, type ProductImageStore } from "@/lib/product-image-binding";

export type PhotoSaveTarget = { kind: "colour"; productId: string; colorId: string } | { kind: "style"; productId: string };

export async function savePhoto(
  prisma: PrismaClient,
  store: ProductImageStore,
  target: PhotoSaveTarget,
  bytes: Uint8Array,
  source: { script: string; file: string },
): Promise<void> {
  const image = { mime: "image/webp", ext: "webp" } as const;
  if (target.kind === "colour") {
    const key = { productId_colorId: { productId: target.productId, colorId: target.colorId } };
    const db = {
      find: async () => {
        const row = await prisma.productColorImage.findUnique({ where: key, select: { imageUrl: true, imagePath: true } });
        return { id: target.productId, imageUrl: row?.imageUrl ?? null, imagePath: row?.imagePath ?? null };
      },
      save: async (_id: string, saved: { url: string; path: string } | null) => {
        if (saved) {
          await prisma.productColorImage.upsert({
            where: key,
            create: { productId: target.productId, colorId: target.colorId, imageUrl: saved.url, imagePath: saved.path },
            update: { imageUrl: saved.url, imagePath: saved.path },
          });
        } else {
          await prisma.productColorImage.deleteMany({ where: { productId: target.productId, colorId: target.colorId } });
        }
      },
    };
    const stored = await replaceProductImage(db, store, target.productId, bytes, image);
    await prisma.auditLog.create({
      data: { action: "PRODUCT_COLOR_IMAGE_SET", entityType: "Product", entityId: target.productId, details: { colorId: target.colorId, path: stored.path, source: source.script, file: source.file } },
    });
    return;
  }
  const db = {
    find: (id: string) => prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true, imagePath: true } }),
    save: async (id: string, saved: { url: string; path: string } | null) => {
      await prisma.product.update({ where: { id }, data: { imageUrl: saved?.url ?? null, imagePath: saved?.path ?? null } });
    },
  };
  const stored = await replaceProductImage(db, store, target.productId, bytes, image);
  await prisma.auditLog.create({
    data: { action: "PRODUCT_IMAGE_SET", entityType: "Product", entityId: target.productId, details: { path: stored.path, source: source.script, file: source.file } },
  });
}
