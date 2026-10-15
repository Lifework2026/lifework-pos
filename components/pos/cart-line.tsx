"use client";

import { memo } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { ProductThumb } from "@/components/pos/product-thumb";
import { Button } from "@/components/ui/button";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
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
  const name = localizedName(locale, item.name, item.nameTh);

  return (
    <li className="flex gap-3 p-4">
      <ProductThumb src={item.imageUrl} alt={name} className="size-14 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              {item.size} · {item.color} · <span className="font-mono">{item.sku}</span>
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t("pos.removeItem", { name })} onClick={() => onRemove(item.variantId)}>
            <Trash2 className="size-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("pos.decreaseQty")}
              onClick={() => onChangeQuantity(item.variantId, item.quantity - 1)}
            >
              <Minus className="size-4" />
            </Button>
            <span className="w-8 text-center font-semibold tabular-nums">{item.quantity}</span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("pos.increaseQty")}
              disabled={atStockLimit}
              onClick={() => onChangeQuantity(item.variantId, item.quantity + 1)}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{formatBaht(item.price * item.quantity)}</p>
            <p className="text-xs text-muted-foreground">{t("pos.eachPrice", { price: formatBaht(item.price) })}</p>
          </div>
        </div>
        {atStockLimit ? <p className="text-xs text-amber-600">{t("pos.maxStock", { stock: item.stockQuantity })}</p> : null}
      </div>
    </li>
  );
});
