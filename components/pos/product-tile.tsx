"use client";

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProductThumb } from "@/components/pos/product-thumb";
import { formatBaht, parseMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { VariantSummary } from "@/lib/pos-types";

interface ProductTileProps {
  variant: VariantSummary;
  onSelect: (variant: VariantSummary) => void;
}

/**
 * One product in the sales grid. Memoized: typing in the search box or changing the category re-renders
 * the grid, but only tiles whose variant actually changed are rebuilt.
 */
export const ProductTile = memo(function ProductTile({ variant, onSelect }: ProductTileProps) {
  const { t, locale } = useI18n();
  const outOfStock = variant.stockQuantity <= 0;
  const name = localizedName(locale, variant.product.name, variant.product.nameTh);

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onSelect(variant)}
      className="text-left disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Card className="h-full overflow-hidden transition-colors hover:border-primary/60">
        <ProductThumb src={variant.product.imageUrl} alt={name} className="aspect-[4/3] w-full rounded-none" />
        <CardContent className="flex flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 font-medium leading-snug">{name}</span>
            {outOfStock ? <Badge variant="destructive">{t("pos.soldOut")}</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{t("pos.size", { size: variant.size })}</Badge>
            <Badge variant="outline">{variant.color}</Badge>
          </div>
          <div className="flex items-end justify-between gap-2">
            <span className="text-base font-semibold">{formatBaht(parseMoney(variant.price))}</span>
            <span className="text-xs text-muted-foreground">{t("pos.left", { count: variant.stockQuantity })}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{variant.sku}</span>
        </CardContent>
      </Card>
    </button>
  );
});
