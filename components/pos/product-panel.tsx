"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Package, Radio, Search } from "lucide-react";
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
  const stripRef = useRef<HTMLDivElement>(null);

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
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            id={BARCODE_INPUT_ID}
            onChange={handleChange}
            placeholder={t("pos.searchPlaceholder")}
            className="h-10 bg-card pl-9 text-[15px]"
            aria-label={t("pos.searchLabel")}
            autoComplete="off"
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground" role="status">
          <span aria-hidden className={`inline-block size-2 rounded-full ${scannerActive ? "bg-emerald-500" : "bg-muted-foreground/60"}`} />
          <Radio className="size-3.5" aria-hidden />
          <span className={scannerActive ? "font-medium text-foreground/80" : ""}>
            {scannerActive ? t("pos.scannerReady") : t("pos.scannerPaused")}
          </span>
          {lastScannedBarcode ? <span className="hidden font-mono text-[11px] xl:inline">{t("pos.lastScan", { code: lastScannedBarcode })}</span> : null}
        </div>
      </div>

      <div className="relative -mx-1">
        <div
          ref={stripRef}
          role="group"
          aria-label={t("pos.products")}
          onWheel={(event) => {
            // A mouse wheel moves the strip sideways, since it has nothing to scroll up or down.
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && stripRef.current) stripRef.current.scrollLeft += event.deltaY;
          }}
          className="scrollbar-none flex snap-x gap-1.5 overflow-x-auto scroll-smooth px-1 py-0.5 pr-10"
        >
          <CategoryPill active={categoryId === null} onClick={() => setCategoryId(null)}>
            {t("pos.all")}
          </CategoryPill>
          {categories.map((category) => (
            <CategoryPill key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>
              {localizedName(locale, category.name, category.nameTh)}
            </CategoryPill>
          ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent" />
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("pos.categoriesNext")}
          onClick={() => stripRef.current?.scrollBy({ left: 280, behavior: "smooth" })}
          className="absolute top-1/2 right-0 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 pr-2">
        {loading && variants.length === 0 ? (
          <ProductGridSkeleton />
        ) : variants.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <Package className="size-8" strokeWidth={1.25} />
            {t("pos.noMatch")}
          </div>
        ) : (
          <div className={`grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5 pb-2 transition-opacity ${loading ? "opacity-70" : ""}`}>
            {variants.map((variant) => (
              <ProductTile key={variant.id} variant={variant} onSelect={onSelectVariant} />
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}

/** One category in the horizontal strip. A dark pill is the active one. */
function CategoryPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 snap-start rounded-full border px-3.5 text-[13px] leading-none whitespace-nowrap transition-colors ${
        active ? "border-foreground bg-foreground font-medium text-background" : "border-border bg-card text-foreground/80 hover:border-foreground/40 hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
