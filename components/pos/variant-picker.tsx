"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductThumb } from "@/components/pos/product-thumb";
import { defaultSelection, styleColors, toVariantSummary, variantsOfColor } from "@/lib/catalog/style-group";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { StyleSummary, VariantSummary } from "@/lib/pos-types";
import { cn } from "@/lib/utils";

interface VariantPickerProps {
  /** The style being picked, or null when closed. */
  style: StyleSummary | null;
  onClose: () => void;
  /** Called with the chosen variant, in the shape a barcode scan produces. The picker closes itself afterwards. */
  onAdd: (variant: VariantSummary) => void;
}

const chip = "flex min-w-12 flex-col items-center justify-center rounded-[3px] border px-3 py-1.5 text-sm leading-tight font-bold transition-colors";

/**
 * The mouse path to the cart: colour, then size, then add. It opens with the first colour that has stock selected, and
 * with the size too when that colour comes in one size. Enter adds. Sizes that are out of stock stay visible but cannot
 * be chosen. A scanned barcode never comes through here: the scanner adds the exact variant at once.
 */
export function VariantPicker({ style, onClose, onAdd }: VariantPickerProps) {
  const { t, locale } = useI18n();
  const [colorId, setColorId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);

  useEffect(() => {
    if (!style) return;
    const start = defaultSelection(style.variants);
    setColorId(start.colorId);
    setVariantId(start.variantId);
  }, [style]);

  const colors = useMemo(() => (style ? styleColors(style.variants) : []), [style]);
  const sizes = style && colorId ? variantsOfColor(style.variants, colorId) : [];
  const selected = style?.variants.find((variant) => variant.id === variantId) ?? null;
  const photo = (selected ?? sizes[0])?.imageUrl ?? style?.imageUrl ?? null;
  const canAdd = !!selected && selected.stockQuantity > 0;
  const name = style ? localizedName(locale, style.name, style.nameTh) : "";

  function add(): void {
    if (!style || !selected || !canAdd) return;
    onAdd(toVariantSummary(style, selected));
    onClose();
  }

  function pickColor(id: string): void {
    setColorId(id);
    if (!style) return;
    const ofColor = variantsOfColor(style.variants, id);
    // Keep the size when the new colour has it in stock, so changing colour does not lose the choice.
    const same = ofColor.find((variant) => variant.size === selected?.size && variant.stockQuantity > 0);
    setVariantId(same?.id ?? (ofColor.length === 1 ? ofColor[0].id : null));
  }

  return (
    <Dialog open={!!style} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        className="gap-4 rounded-[4px] sm:max-w-lg"
        onKeyDown={(event) => {
          if (event.key === "Enter" && canAdd) {
            event.preventDefault();
            add();
          }
        }}
      >
        {style ? (
          <>
            <DialogHeader>
              <DialogTitle className="num text-lg font-extrabold tracking-tight uppercase">{name}</DialogTitle>
              <DialogDescription className="sr-only">{t("pos.pickOptions")}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-[9rem_1fr] gap-4">
              <ProductThumb src={photo} alt={name} fit="contain" className={cn("aspect-[4/5] w-full rounded-[3px] border border-foreground/20", photo ? "bg-white" : "bg-muted")} />
              <div className="flex min-w-0 flex-col gap-3">
                <p className="num text-3xl leading-none font-extrabold tracking-tight">{formatBaht(Number((selected ?? sizes[0] ?? style.variants[0]).price))}</p>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">{t("pos.pickColor")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {colors.map((color) => (
                      <button
                        key={color.colorId}
                        type="button"
                        aria-pressed={color.colorId === colorId}
                        onClick={() => pickColor(color.colorId)}
                        className={cn(
                          chip,
                          "flex-row gap-1.5",
                          color.colorId === colorId ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-card hover:border-foreground",
                          color.stock <= 0 && color.colorId !== colorId && "text-muted-foreground",
                        )}
                      >
                        {color.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">{t("pos.pickSize")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sizes.map((variant) => {
                      const out = variant.stockQuantity <= 0;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          aria-pressed={variant.id === variantId}
                          disabled={out}
                          title={out ? t("pos.soldOut") : undefined}
                          onClick={() => setVariantId(variant.id)}
                          className={cn(
                            chip,
                            variant.id === variantId ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-card hover:border-foreground",
                            out && "cursor-not-allowed border-dashed text-muted-foreground hover:border-foreground/25",
                          )}
                        >
                          <span className="num">{variant.size}</span>
                          <span className={cn("num text-[10px] font-medium", out ? "text-destructive" : variant.id === variantId ? "text-background/70" : "text-muted-foreground")}>
                            {variant.stockQuantity}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <p className="num min-h-4 text-[11px] text-muted-foreground">{selected ? selected.sku : ""}</p>
              </div>
            </div>

            <Button
              size="lg"
              className="h-12 w-full justify-between rounded-[3px] px-5 text-sm font-extrabold tracking-wider uppercase disabled:bg-muted-foreground/25 disabled:text-muted-foreground disabled:opacity-100"
              disabled={!canAdd}
              onClick={add}
            >
              <span>{selected && !canAdd ? t("pos.soldOut") : selected ? t("pos.addToCart") : t("pos.pickOptions")}</span>
              {selected ? <span className="num">{formatBaht(Number(selected.price))}</span> : null}
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
