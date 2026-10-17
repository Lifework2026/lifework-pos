"use client";

import { memo } from "react";
import { ProductCard } from "@/components/pos/product-card";
import { parseMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { VariantSummary } from "@/lib/pos-types";

interface ProductTileProps {
  variant: VariantSummary;
  onSelect: (variant: VariantSummary) => void;
}

/**
 * One product in the sales grid. Memoized: typing in the search box or changing the category re-renders
 * the grid, but only tiles whose variant actually changed are rebuilt. The card itself is ProductCard.
 * A sold-out tile cannot be pressed; the card mutes itself instead of the whole button fading.
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
      className="group/tile block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] disabled:cursor-not-allowed disabled:active:scale-100"
    >
      <ProductCard
        name={name}
        imageUrl={variant.product.imageUrl}
        sku={variant.sku}
        size={variant.size}
        color={variant.color}
        price={parseMoney(variant.price)}
        stockLabel={t("pos.left", { count: variant.stockQuantity })}
        promoTag={variant.product.promoTag}
        soldOut={outOfStock}
      />
    </button>
  );
});
