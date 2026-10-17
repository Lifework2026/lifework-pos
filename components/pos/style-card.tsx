"use client";

import { memo } from "react";
import { ProductThumb } from "@/components/pos/product-thumb";
import { priceRange, styleBadge, totalStock } from "@/lib/catalog/style-group";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { StyleSummary } from "@/lib/pos-types";
import { cn } from "@/lib/utils";

interface StyleCardProps {
  style: StyleSummary;
  onOpen: (style: StyleSummary) => void;
}

/**
 * One style in the sales grid: the style code, its main photo, the selling price and a summary of what it comes in
 * ("2 COLORS · F", "1 COLOR · 5 SIZES"). A click opens the colour and size picker. Memoized, because typing in the
 * search box re-renders the grid and only cards whose style changed should be rebuilt.
 *
 * A style with nothing in stock keeps its photo and price at full strength and only carries a small OUT OF STOCK tag,
 * so the catalogue can still be judged by eye.
 */
export const StyleCard = memo(function StyleCard({ style, onOpen }: StyleCardProps) {
  const { t, locale } = useI18n();
  const name = localizedName(locale, style.name, style.nameTh);
  const stock = totalStock(style.variants);
  const { min, max } = priceRange(style.variants);
  const photo = style.imageUrl ?? style.variants.find((variant) => variant.imageUrl)?.imageUrl ?? null;
  const soldOut = stock <= 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(style)}
      className="group/tile block w-full rounded-[3px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985]"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-[3px] border border-foreground/20 bg-card transition-colors group-hover/tile:border-foreground">
        <div className="relative">
          <ProductThumb src={photo} alt={name} fit="contain" className={cn("aspect-[5/4] w-full rounded-none", photo ? "bg-white" : "bg-muted")} />
          {soldOut ? (
            <span className="absolute top-1.5 left-1.5 rounded-[2px] bg-foreground px-1.5 py-1 text-[9px] leading-none font-bold tracking-wider text-background uppercase">
              {t("pos.outOfStockBadge")}
            </span>
          ) : null}
          {style.promoTag ? (
            <span className="absolute top-1.5 right-1.5 rounded-[2px] bg-amber-400 px-1.5 py-1 text-[9px] leading-none font-bold tracking-wider text-black uppercase">
              {style.promoTag}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-t border-foreground/20 p-2.5">
          <p className="num truncate text-[13px] leading-tight font-extrabold tracking-tight uppercase" title={name}>
            {name}
          </p>
          <p className="w-fit max-w-full truncate rounded-[2px] border border-foreground/25 px-1.5 py-px text-[10px] leading-4 font-semibold tracking-wide text-foreground">
            {styleBadge(style.variants)}
          </p>
          <div className="mt-auto flex items-baseline justify-between gap-2 pt-0.5">
            <span className="num text-[15px] leading-none font-extrabold">
              {formatBaht(min)}
              {max > min ? <span className="text-[11px] font-bold text-muted-foreground">+</span> : null}
            </span>
            <span className={cn("num text-[11px] leading-none", soldOut ? "font-bold text-destructive" : "text-muted-foreground")}>
              {t("pos.left", { count: stock })}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
});
