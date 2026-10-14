"use client";

import { useEffect, useState } from "react";
import { Loader2, Package, Radio, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBaht, parseMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { localizedName } from "@/lib/payment-labels";
import type { CategorySummary, VariantSummary } from "@/lib/pos-types";

const SEARCH_DEBOUNCE_MS = 250;

interface ProductPanelProps {
  onSelectVariant: (variant: VariantSummary) => void;
  scannerActive: boolean;
  lastScannedBarcode: string | null;
}

export function ProductPanel({ onSelectVariant, scannerActive, lastScannedBarcode }: ProductPanelProps) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [variants, setVariants] = useState<VariantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/categories", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("categories");
        const body: { categories: CategorySummary[] } = await res.json();
        setCategories(body.categories);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorKey("pos.categoriesError");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (categoryId) params.set("categoryId", categoryId);

    setLoading(true);
    fetch(`/api/products?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("products");
        const body: { variants: VariantSummary[] } = await res.json();
        setVariants(body.variants);
        setErrorKey(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorKey("pos.productsError");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery, categoryId]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block size-2.5 rounded-full ${scannerActive ? "bg-emerald-500" : "bg-muted-foreground"}`}
          />
          <Badge variant={scannerActive ? "secondary" : "outline"} className="gap-1">
            <Radio className="size-3" />
            {scannerActive ? t("pos.scannerReady") : t("pos.scannerPaused")}
          </Badge>
          {lastScannedBarcode ? (
            <span className="font-mono text-xs text-muted-foreground">{t("pos.lastScan", { code: lastScannedBarcode })}</span>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("pos.searchPlaceholder")}
          className="h-11 pl-9 text-base"
          aria-label={t("pos.searchLabel")}
          autoComplete="off"
          onKeyDown={(event) => {
            // Leaving the field hands keyboard input back to the barcode scanner.
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("pos.products")}>
        <Button size="sm" variant={categoryId === null ? "default" : "outline"} onClick={() => setCategoryId(null)}>
          {t("pos.all")}
        </Button>
        {categories.map((category) => (
          <Button
            key={category.id}
            size="sm"
            variant={categoryId === category.id ? "default" : "outline"}
            onClick={() => setCategoryId(category.id)}
          >
            {localizedName(locale, category.name, category.nameTh)}
          </Button>
        ))}
      </div>

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 pr-3">
        {loading && variants.length === 0 ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("pos.loadingProducts")}
          </div>
        ) : variants.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <Package className="size-8" />
            {t("pos.noMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {variants.map((variant) => {
              const outOfStock = variant.stockQuantity <= 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => onSelectVariant(variant)}
                  className="text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Card className="h-full transition-colors hover:border-primary/60">
                    <CardContent className="flex flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 font-medium leading-snug">
                          {localizedName(locale, variant.product.name, variant.product.nameTh)}
                        </span>
                        {outOfStock ? <Badge variant="destructive">{t("pos.soldOut")}</Badge> : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline">{t("pos.size", { size: variant.size })}</Badge>
                        <Badge variant="outline">{variant.color}</Badge>
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <span className="text-base font-semibold">{formatBaht(parseMoney(variant.price))}</span>
                        <span className="text-xs text-muted-foreground">{t("pos.left", { count: variant.stockQuantity })}</span>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">{variant.sku}</span>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
