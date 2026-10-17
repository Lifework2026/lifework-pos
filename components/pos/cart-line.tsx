"use client";

import { memo } from "react";
import { Minus, Plus, X } from "lucide-react";
import { ProductThumb } from "@/components/pos/product-thumb";
import { Button } from "@/components/ui/button";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { isFreeBag } from "@/lib/catalog/free-bags";
import { localizedName } from "@/lib/payment-labels";
import type { CartItem } from "@/store/useCartStore";

interface CartLineProps {
  item: CartItem;
  onChangeQuantity: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
}

/**
 * One line in the cart. Memoized so that changing one quantity does not re-render every other line.
 * The handlers come from the store and are stable, so memoization holds.
 */
export const CartLine = memo(function CartLine({ item, onChangeQuantity, onRemove }: CartLineProps) {
  const { t, locale } = useI18n();
  const atStockLimit = item.quantity >= item.stockQuantity;
  const bag = isFreeBag(item.sku);
  const name = localizedName(locale, item.name, item.nameTh) + (bag ? ` (${item.size})` : "");

  return (
    <li className="flex gap-3 px-4 py-3">
      <ProductThumb src={item.imageUrl} alt={name} fit="contain" className="size-12 shrink-0 rounded-md border bg-white" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] leading-tight font-semibold">{name}</p>
            <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              {bag ? null : <span className="rounded border border-foreground/25 px-1 font-semibold text-foreground">{item.size}</span>}
              {bag ? null : <span className="truncate">{item.color}</span>}
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/80">{item.sku}</span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mt-1 -mr-1 text-muted-foreground hover:text-destructive"
            aria-label={t("pos.removeItem", { name })}
            onClick={() => onRemove(item.variantId)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              className="size-8"
              aria-label={t("pos.decreaseQty")}
              onClick={() => onChangeQuantity(item.variantId, item.quantity - 1)}
            >
              <Minus className="size-4" />
            </Button>
            <span className="num w-8 text-center text-[15px] font-semibold">{item.quantity}</span>
            <Button
              variant="outline"
              size="icon-sm"
              className="size-8"
              aria-label={t("pos.increaseQty")}
              disabled={atStockLimit}
              onClick={() => onChangeQuantity(item.variantId, item.quantity + 1)}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="text-right">
            <p className="num text-[15px] leading-tight font-bold">{formatBaht(item.price * item.quantity)}</p>
            <p className="num text-[11px] text-muted-foreground">{t("pos.eachPrice", { price: formatBaht(item.price) })}</p>
          </div>
        </div>
        {atStockLimit ? <p className="text-xs text-amber-700">{t("pos.maxStock", { stock: item.stockQuantity })}</p> : null}
      </div>
    </li>
  );
});
