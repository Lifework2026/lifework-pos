"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProductThumb } from "@/components/pos/product-thumb";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";

export interface ProductCardProps {
  name: string;
  imageUrl: string | null;
  sku: string;
  size: string;
  color: string;
  /** Selling price in baht. */
  price: number;
  stockLabel: string;
  promoTag: string | null;
  soldOut?: boolean;
  className?: string;
  /** Preview only: the category line under the badges. The till does not show it. */
  categoryName?: string | null;
  /** Preview only: size chips in place of the single size badge. The active chip is the card's own size. */
  sizes?: { label: string; active: boolean }[];
}

/**
 * The product card from the sales grid. The till's ProductTile and the back-office import preview both render it,
 * so a preview looks exactly like the till. The preview-only props default to the till's markup.
 */
export function ProductCard({
  name,
  imageUrl,
  sku,
  size,
  color,
  price,
  stockLabel,
  promoTag,
  soldOut = false,
  className = "",
  categoryName,
  sizes,
}: ProductCardProps) {
  const { t } = useI18n();

  return (
    <Card className={`h-full overflow-hidden transition-colors hover:border-primary/60 ${className}`}>
      <ProductThumb src={imageUrl} alt={name} className="aspect-[4/3] w-full rounded-none" />
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 font-medium leading-snug">{name}</span>
          {soldOut ? <Badge variant="destructive">{t("pos.soldOut")}</Badge> : null}
          {promoTag ? <Badge className="bg-amber-500 text-white hover:bg-amber-500">{promoTag}</Badge> : null}
        </div>
        {categoryName ? <p className="text-xs text-muted-foreground">{categoryName}</p> : null}
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {sizes ? (
            sizes.map((chip) => (
              <span
                key={chip.label}
                aria-current={chip.active ? "true" : undefined}
                className={`inline-flex min-w-7 items-center justify-center rounded-md border px-2 py-0.5 font-semibold ${
                  chip.active ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70"
                }`}
              >
                {chip.label}
              </span>
            ))
          ) : (
            <Badge variant="outline">{t("pos.size", { size })}</Badge>
          )}
          <Badge variant="outline">{color}</Badge>
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="text-base font-semibold">{formatBaht(price)}</span>
          <span className="text-xs text-muted-foreground">{stockLabel}</span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">{sku}</span>
      </CardContent>
    </Card>
  );
}
