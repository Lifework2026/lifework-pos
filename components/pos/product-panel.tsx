"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Package, Radio, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StyleCard } from "@/components/pos/style-card";
import { VariantPicker } from "@/components/pos/variant-picker";
import { ProductGridSkeleton } from "@/components/pos/skeletons";
import { useScannerInput } from "@/hooks/useScannerInput";
import type { ScanDecision } from "@/lib/scanner-input";
import { useI18n } from "@/lib/i18n/client";
import { BARCODE_INPUT_ID, focusBarcodeField } from "@/lib/pos-focus";
import type { MessageKey } from "@/lib/i18n/messages";
import { localizedName } from "@/lib/payment-labels";
import type { CategorySummary, StyleSummary, VariantSummary } from "@/lib/pos-types";

const SEARCH_DEBOUNCE_MS = 250;
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
  const [styles, setStyles] = useState<StyleSummary[]>([]);
  /** The style whose colour and size are being chosen with the mouse. */
  const [picked, setPicked] = useState<StyleSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const { handleChange, handleKeyDown } = useScannerInput({
    value: query,
    setValue: setQuery,
    onScan,
    // The scanner pauses while the picker is open, so a scan cannot land in the picker.
    enabled: scannerActive && !picked,
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
  const cacheRef = useRef(new Map<string, StyleSummary[]>());
  const stripRef = useRef<HTMLDivElement>(null);
  /** Which way the category strip can still be moved, so each arrow only shows when it has somewhere to go. */
  const [arrows, setArrows] = useState({ left: false, right: false });
  function updateStripArrows(): void {
    const strip = stripRef.current;
    if (!strip) return;
    const left = strip.scrollLeft > 4;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4;
    setArrows((current) => (current.left === left && current.right === right ? current : { left, right }));
  }
  useEffect(() => {
    updateStripArrows();
    window.addEventListener("resize", updateStripArrows);
    return () => window.removeEventListener("resize", updateStripArrows);
  }, [categories]);

  // Searching looks in every category: a category chosen earlier would otherwise hide the style being searched for.
  useEffect(() => {
    if (query.trim() !== "") setCategoryId(null);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (categoryId) params.set("categoryId", categoryId);
    const key = params.toString();

    const cached = cacheRef.current.get(key);
    if (cached) setStyles(cached);

    setLoading(true);
    fetch(`/api/products/styles?${key}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("products");
        const body: { styles: StyleSummary[] } = await res.json();
        const cache = cacheRef.current;
        cache.delete(key);
        cache.set(key, body.styles);
        if (cache.size > RESULT_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
        setStyles(body.styles);
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

  // After a mouse click the cursor goes back to the barcode field, so the next scan is never lost.
  function addPicked(variant: VariantSummary): void {
    onSelectVariant(variant);
  }
  function closePicker(): void {
    setPicked(null);
    // The scanner is switched back on in the next render; the cursor follows once the dialog has gone.
    window.setTimeout(focusBarcodeField, 50);
  }
  function selectCategory(id: string | null): void {
    setCategoryId(id);
    focusBarcodeField();
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            id={BARCODE_INPUT_ID}
            autoFocus
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
          onScroll={updateStripArrows}
          onWheel={(event) => {
            // A mouse wheel moves the strip sideways, since it has nothing to scroll up or down.
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && stripRef.current) stripRef.current.scrollLeft += event.deltaY;
          }}
          className="scrollbar-none flex snap-x gap-1.5 overflow-x-auto scroll-smooth px-1 py-0.5 pr-10 pl-1"
        >
          <CategoryPill active={categoryId === null} onClick={() => selectCategory(null)}>
            {t("pos.all")}
          </CategoryPill>
          {categories.map((category) => (
            <CategoryPill key={category.id} active={categoryId === category.id} onClick={() => selectCategory(category.id)}>
              {localizedName(locale, category.name, category.nameTh)}
            </CategoryPill>
          ))}
        </div>
        {arrows.left ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-card to-transparent" />
            <StripArrow side="left" label={t("pos.categoriesPrev")} onClick={() => stripRef.current?.scrollBy({ left: -280, behavior: "smooth" })} />
          </>
        ) : null}
        {arrows.right ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent" />
            <StripArrow side="right" label={t("pos.categoriesNext")} onClick={() => stripRef.current?.scrollBy({ left: 280, behavior: "smooth" })} />
          </>
        ) : null}
      </div>

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 pr-2">
        {loading && styles.length === 0 ? (
          <ProductGridSkeleton />
        ) : styles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <Package className="size-8" strokeWidth={1.25} />
            {t("pos.noMatch")}
          </div>
        ) : (
          <div className={`grid grid-cols-4 gap-2.5 pb-2 min-[1280px]:grid-cols-5 min-[1600px]:grid-cols-6 transition-opacity ${loading ? "opacity-70" : ""}`}>
            {styles.map((style) => (
              <StyleCard key={style.id} style={style} onOpen={setPicked} />
            ))}
          </div>
        )}
      </ScrollArea>
      <VariantPicker style={picked} onClose={closePicker} onAdd={addPicked} />
    </section>
  );
}

/** The arrow at either end of the category strip. */
function StripArrow({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-[3px] border border-foreground/30 bg-card text-foreground hover:bg-foreground hover:text-background ${side === "left" ? "left-0" : "right-0"}`}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

/** One category in the horizontal strip. A dark pill is the active one. */
function CategoryPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 snap-start rounded-[3px] border px-3.5 text-[12px] leading-none font-bold tracking-wide whitespace-nowrap uppercase transition-colors ${
        active ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-card text-foreground/80 hover:border-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
