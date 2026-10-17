"use client";

import { useEffect, useRef, useState } from "react";
import { Package, Radio, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProductTile } from "@/components/pos/product-tile";
import { ProductGridSkeleton } from "@/components/pos/skeletons";
import { useScannerInput } from "@/hooks/useScannerInput";
import type { ScanDecision } from "@/lib/scanner-input";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { localizedName } from "@/lib/payment-labels";
import type { CategorySummary, VariantSummary } from "@/lib/pos-types";

const SEARCH_DEBOUNCE_MS = 250;
/** The POS barcode field. Scanning is handled here and nowhere else on the page. */
const BARCODE_INPUT_ID = "pos-barcode-input";
/** Recent searches kept in memory. Repeating a search or category shows the last result at once. */
const RESULT_CACHE_SIZE = 40;

interface ProductPanelProps {
  onSelectVariant: (variant: VariantSummary) => void;
  scannerActive: boolean;
  lastScannedBarcode: string | null;
  /** Looks the scanned code up and adds it to the cart. Resolves true when it was added. */
  onScan: (decision: ScanDecision) => Promise<boolean>;
}

export function ProductPanel({ onSelectVariant, scannerActive, lastScannedBarcode, onScan }: ProductPanelProps) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [variants, setVariants] = useState<VariantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const { handleChange, handleKeyDown } = useScannerInput({
    value: query,
    setValue: setQuery,
    onScan,
    enabled: scannerActive,
    inputId: BARCODE_INPUT_ID,
  });

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

  // Recent results, so a repeated search or category shows at once while a fresh copy loads in the background.
  const cacheRef = useRef(new Map<string, VariantSummary[]>());

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (categoryId) params.set("categoryId", categoryId);
    const key = params.toString();

    const cached = cacheRef.current.get(key);
    if (cached) setVariants(cached);

    setLoading(true);
    fetch(`/api/products?${key}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("products");
        const body: { variants: VariantSummary[] } = await res.json();
        const cache = cacheRef.current;
        cache.delete(key);
        cache.set(key, body.variants);
        if (cache.size > RESULT_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
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
          <span aria-hidden className={`inline-block size-2.5 rounded-full ${scannerActive ? "bg-emerald-500" : "bg-muted-foreground"}`} />
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
          id={BARCODE_INPUT_ID}
          onChange={handleChange}
          placeholder={t("pos.searchPlaceholder")}
          className="h-11 pl-9 text-base"
          aria-label={t("pos.searchLabel")}
          autoComplete="off"
          onKeyDown={handleKeyDown}
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
          <ProductGridSkeleton />
        ) : variants.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <Package className="size-8" />
            {t("pos.noMatch")}
          </div>
        ) : (
          <div className={`grid grid-cols-2 gap-3 transition-opacity xl:grid-cols-3 ${loading ? "opacity-70" : ""}`}>
            {variants.map((variant) => (
              <ProductTile key={variant.id} variant={variant} onSelect={onSelectVariant} />
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
