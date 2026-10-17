"use client";

import { useState } from "react";
import { ShoppingBag, X } from "lucide-react";
import { FREE_BAG_SIZES, FREE_BAG_TYPES, freeBagSku, type FreeBagSize, type FreeBagType } from "@/lib/catalog/free-bags";
import { useI18n } from "@/lib/i18n/client";
import { focusBarcodeField } from "@/lib/pos-focus";
import { cn } from "@/lib/utils";

interface QuickBagProps {
  /** Adds the bag with this SKU to the cart. Resolves true when it was added. */
  onAdd: (sku: string) => Promise<boolean>;
  disabled?: boolean;
}

/**
 * The free-bag shortcut above the cart lines: one button opens a small panel with Paper and Rpet, each in S, M and L.
 * Pressing a size puts that bag in the cart at 0 baht and closes the panel. The cursor goes back to the barcode field.
 */
export function QuickBag({ onAdd, disabled = false }: QuickBagProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(type: FreeBagType, size: FreeBagSize): Promise<void> {
    if (busy) return;
    setBusy(true);
    const added = await onAdd(freeBagSku(type, size));
    setBusy(false);
    if (added) setOpen(false);
    focusBarcodeField();
  }

  return (
    <div className="border-b px-4 py-2" onClickCapture={focusBarcodeField}>
      {open ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">{t("bag.title")}</p>
            <button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          {FREE_BAG_TYPES.map((bag) => (
            <div key={bag.key} className="flex items-center gap-2">
              <span className="w-14 text-[12px] font-extrabold tracking-wide uppercase">{bag.label}</span>
              <div className="grid flex-1 grid-cols-3 gap-1.5">
                {FREE_BAG_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    disabled={busy}
                    data-bag={freeBagSku(bag.key, size)}
                    onClick={() => void add(bag.key, size)}
                    className={cn(
                      "num h-9 rounded-[3px] border border-foreground/30 bg-card text-sm font-bold transition-colors",
                      "hover:border-foreground hover:bg-foreground hover:text-background disabled:cursor-wait disabled:opacity-60",
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[3px] border border-dashed border-foreground/40 text-[12px] font-extrabold tracking-wider uppercase transition-colors hover:border-solid hover:border-foreground hover:bg-muted disabled:opacity-50"
        >
          <ShoppingBag className="size-3.5" />
          {t("bag.add")}
        </button>
      )}
    </div>
  );
}
