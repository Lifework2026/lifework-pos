"use client";

import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import { useCartStore } from "@/store/useCartStore";

interface CartPanelProps {
  onCheckout: () => void;
}

export function CartPanel({ onCheckout }: CartPanelProps) {
  const { t, locale } = useI18n();
  const items = useCartStore((state) => state.items);
  const discount = useCartStore((state) => state.discount);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const setDiscount = useCartStore((state) => state.setDiscount);
  const subtotal = useCartStore((state) => state.getSubtotal());
  const total = useCartStore((state) => state.getTotal());

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const canCheckout = items.length > 0 && total > 0;

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingCart className="size-5" />
          {t("pos.cart")}
          <span className="text-sm font-normal text-muted-foreground">({t("pos.itemCount", { count: itemCount })})</span>
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={clearCart} disabled={items.length === 0}>
          {t("pos.clear")}
        </Button>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-0">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <ShoppingCart className="size-8" />
            {t("pos.emptyCart")}
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col divide-y">
              {items.map((item) => {
                const atStockLimit = item.quantity >= item.stockQuantity;
                const name = localizedName(locale, item.name, item.nameTh);
                return (
                  <li key={item.variantId} className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.size} · {item.color} · <span className="font-mono">{item.sku}</span>
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("pos.removeItem", { name })}
                        onClick={() => removeItem(item.variantId)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t("pos.decreaseQty")}
                          onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                        >
                          <Minus className="size-4" />
                        </Button>
                        <span className="w-8 text-center font-semibold tabular-nums">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t("pos.increaseQty")}
                          disabled={atStockLimit}
                          onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{formatBaht(item.price * item.quantity)}</p>
                        <p className="text-xs text-muted-foreground">{t("pos.eachPrice", { price: formatBaht(item.price) })}</p>
                      </div>
                    </div>
                    {atStockLimit ? (
                      <p className="text-xs text-amber-600">{t("pos.maxStock", { stock: item.stockQuantity })}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}

        <div className="flex flex-col gap-3 border-t p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("pos.subtotalBeforePromo")}</span>
            <span className="tabular-nums">{formatBaht(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor="discount" className="text-muted-foreground">
              {t("pos.manualDiscount")}
            </label>
            <Input
              id="discount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              max={subtotal}
              value={discount === 0 ? "" : discount}
              placeholder="0.00"
              onChange={(event) => setDiscount(Number(event.target.value))}
              className="h-9 w-32 text-right tabular-nums"
              disabled={items.length === 0}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-base font-medium">{t("pos.total")}</span>
            <span className="text-2xl font-bold tabular-nums">{formatBaht(total)}</span>
          </div>
          <Button size="lg" className="h-12 text-base" disabled={!canCheckout} onClick={onCheckout}>
            {t("pos.checkout")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
