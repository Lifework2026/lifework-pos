"use client";

import { ProductThumb } from "@/components/pos/product-thumb";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

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
  /** Preview only: the category line under the name. The till does not show it. */
  categoryName?: string | null;
  /** Preview only: size chips in place of the single size chip. The active chip is the card's own size. */
  sizes?: { label: string; active: boolean }[];
}

/**
 * The product card from the sales grid. The till's ProductTile and the back-office import preview both render it,
 * so a preview looks exactly like the till. The preview-only props default to the till's markup.
 *
 * Compact on purpose: a square photo on a white mat, then name, size and colour chips, price and stock, then the SKU.
 * A sold-out card is muted (grey photo, grey price) with a small badge on the photo; it is never hidden or struck out.
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
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors group-hover/tile:border-foreground/35",
        soldOut && "bg-muted/40",
        className,
      )}
    >
      <div className="relative">
        <ProductThumb
          src={imageUrl}
          alt={name}
          fit="contain"
          className={cn("aspect-square w-full rounded-none", imageUrl ? "bg-white" : "bg-muted/70", soldOut && "opacity-60 grayscale")}
        />
        {soldOut ? (
          <span className="absolute top-1.5 left-1.5 rounded bg-foreground/85 px-1.5 py-0.5 text-[10px] leading-none font-medium text-background">
            {t("pos.soldOut")}
          </span>
        ) : null}
        {promoTag ? (
          <span className="absolute top-1.5 right-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white">
            {promoTag}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-t p-2.5">
        <p className={cn("truncate text-[13px] leading-tight font-semibold", soldOut && "text-muted-foreground")} title={name}>
          {name}
        </p>
        {categoryName ? <p className="truncate text-[11px] text-muted-foreground">{categoryName}</p> : null}

        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
          {sizes ? (
            sizes.map((chip) => (
              <span
                key={chip.label}
                aria-current={chip.active ? "true" : undefined}
                className={cn(
                  "inline-flex min-w-6 items-center justify-center rounded border px-1.5 py-px leading-4 font-semibold",
                  chip.active ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70",
                )}
              >
                {chip.label}
              </span>
            ))
          ) : (
            <span
              className="inline-flex min-w-6 items-center justify-center rounded border border-foreground/25 px-1.5 py-px leading-4 font-semibold text-foreground"
              aria-label={t("pos.size", { size })}
              title={t("pos.size", { size })}
            >
              {size}
            </span>
          )}
          <span className="min-w-0 max-w-full truncate rounded bg-muted px-1.5 py-px leading-4 text-muted-foreground" title={color}>
            {color}
          </span>
        </div>

        <div className="mt-auto flex items-baseline justify-between gap-2 pt-0.5">
          <span className={cn("num text-[15px] leading-none font-bold", soldOut && "font-semibold text-muted-foreground")}>{formatBaht(price)}</span>
          <span className="num text-[11px] leading-none text-muted-foreground">{stockLabel}</span>
        </div>
        <p className="truncate font-mono text-[10px] leading-none text-muted-foreground/80">{sku}</p>
      </div>
    </div>
  );
}
