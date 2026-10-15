"use client";

import { PauseCircle, ShoppingCart } from "lucide-react";
import { CartLine } from "@/components/pos/cart-line";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { useCartStore } from "@/store/useCartStore";

interface CartPanelProps {
  onCheckout: () => void;
  onHold: () => void;
  onOpenHeld: () => void;
  heldCount: number;
  holding: boolean;
}

export function CartPanel({ onCheckout, onHold, onOpenHeld, heldCount, holding }: CartPanelProps) {
  const { t } = useI18n();
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
      <CardHeader className="flex flex-col gap-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShoppingCart className="size-5" />
            {t("pos.cart")}
            <span className="text-sm font-normal text-muted-foreground">({t("pos.itemCount", { count: itemCount })})</span>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={clearCart} disabled={items.length === 0}>
            {t("pos.clear")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onHold} disabled={items.length === 0 || holding}>
            <PauseCircle className="size-4" />
            {t("hold.hold")}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenHeld}>
            {t("hold.held")}
            {heldCount > 0 ? (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{heldCount}</span>
            ) : null}
          </Button>
        </div>
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
              {items.map((item) => (
                <CartLine key={item.variantId} item={item} onChangeQuantity={updateQuantity} onRemove={removeItem} />
              ))}
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
