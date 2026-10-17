"use client";

import { useState } from "react";
import { ProductImageField, type ProductImage } from "@/components/admin/product-image-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ColorGroup } from "@/lib/catalog/variant-image";
import { useI18n } from "@/lib/i18n/client";

interface ProductColorPhotosProps {
  productId: string;
  /** One group per colour the product is sold in, each with its sizes. */
  groups: ColorGroup[];
  images: { colorId: string; imageUrl: string; imagePath: string }[];
  storageReady: boolean;
  disabled?: boolean;
}

/**
 * One photo slot per colour. Every size in a colour shares its photo, so a style with three colours needs three photos,
 * however many sizes it has. Each photo is saved to the product the moment it uploads.
 */
export function ProductColorPhotos({ productId, groups, images, storageReady, disabled }: ProductColorPhotosProps) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<Record<string, ProductImage | null>>(() => {
    const start: Record<string, ProductImage | null> = {};
    for (const image of images) start[image.colorId] = { url: image.imageUrl, path: image.imagePath };
    return start;
  });

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("products.colorPhotosTitle")}</CardTitle>
        <CardDescription>{t("products.colorPhotosHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.colorId} className="flex flex-col gap-2 rounded-lg border p-3">
            <div>
              <p className="font-medium">{group.color}</p>
              <p className="text-xs text-muted-foreground">{t("products.colorPhotoSizes", { sizes: group.sizes.join(", ") })}</p>
            </div>
            <ProductImageField
              value={photos[group.colorId] ?? null}
              onChange={(next) => setPhotos((current) => ({ ...current, [group.colorId]: next }))}
              storageReady={storageReady}
              disabled={disabled}
              alt={group.color}
              saveUrl={`/api/admin/products/${productId}/colors/${group.colorId}/image`}
            />
          </div>
        ))}
      </CardContent>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{t("products.colorPhotosSaveFirst")}</p>
      </CardContent>
    </Card>
  );
}
