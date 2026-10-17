"use client";

import { PauseCircle, ShoppingCart } from "lucide-react";
import { CartLine } from "@/components/pos/cart-line";
import { useOnline } from "@/components/network-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { focusBarcodeField } from "@/lib/pos-focus";
import { useCartStore } from "@/store/useCartStore";

interface CartPanelProps {
  onCheckout: () => void;
  onHold: () => void;
  onOpenHeld: () => void;
  heldCount: number;
  holding: boolean;
}

/**
 * The right-hand side of the till: the bill so far, the discount, a large total, and the pay button.
 * Reading order is top to bottom: what is on the bill, what it adds up to, then the one action that matters.
 */
export function CartPanel({ onCheckout, onHold, onOpenHeld, heldCount, holding }: CartPanelProps) {
  const { t } = useI18n();
  const online = useOnline();
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
  const saved = Math.max(0, subtotal - total);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-col gap-2.5 border-b px-4 py-3" onClickCapture={focusBarcodeField}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[14px] font-extrabold">
            <ShoppingCart className="size-[18px]" />
            {t("pos.cart")}
            <span className="num rounded-[2px] bg-foreground px-1.5 py-0.5 text-[11px] font-bold text-background">{t("pos.itemCount", { count: itemCount })}</span>
          </h2>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={clearCart} disabled={items.length === 0}>
            {t("pos.clear")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={onHold} disabled={items.length === 0 || holding}>
            <PauseCircle className="size-4" />
            {t("hold.hold")}
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={onOpenHeld}>
            {t("hold.held")}
            {heldCount > 0 ? (
              <span className="num ml-1 rounded-[2px] bg-primary px-1.5 text-[11px] leading-4 font-bold text-primary-foreground">{heldCount}</span>
            ) : null}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <ShoppingCart className="size-8" strokeWidth={1.25} />
            {t("pos.emptyCart")}
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col divide-y" onClickCapture={focusBarcodeField}>
              {items.map((item) => (
                <CartLine key={item.variantId} item={item} onChangeQuantity={updateQuantity} onRemove={removeItem} />
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t bg-card p-4 shadow-[0_-6px_12px_-10px_rgb(0_0_0/0.25)]">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("pos.subtotalBeforePromo")}</span>
            <span className="num font-medium">{formatBaht(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="discount" className="font-medium">
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
              onKeyDown={(event) => {
                // Enter finishes typing the discount and hands the cursor back to the scanner.
                if (event.key === "Enter") focusBarcodeField();
              }}
              className="num h-9 w-32 bg-card text-right text-[15px] font-medium"
              disabled={items.length === 0}
            />
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 rounded-lg bg-muted px-3.5 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-extrabold tracking-wider uppercase">{t("pos.total")}</span>
            {saved > 0 ? <span className="num text-xs font-medium text-emerald-700">{t("pos.youSave", { amount: `−${formatBaht(saved)}` })}</span> : null}
          </div>
          <span className="num text-[2rem] leading-none font-bold tracking-tight">{formatBaht(total)}</span>
        </div>

        <Button
          size="lg"
          className="h-14 w-full justify-between rounded-[3px] bg-black px-5 text-base font-extrabold tracking-wider uppercase hover:bg-zinc-800 disabled:bg-muted-foreground/25 disabled:text-muted-foreground disabled:opacity-100"
          disabled={!canCheckout || !online}
          onClick={onCheckout}
        >
          <span>{t("pos.checkout")}</span>
          <span className="num">{formatBaht(total)}</span>
        </Button>
      </footer>
    </section>
  );
}
