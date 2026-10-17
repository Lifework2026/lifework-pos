"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";

interface Option {
  code: string;
  name: string;
  nameTh: string | null;
}

interface ProductFiltersProps {
  q: string;
  category: string;
  color: string;
  status: string;
  image: string;
  categories: Option[];
  colors: Option[];
}

interface FilterState {
  q: string;
  category: string;
  color: string;
  status: string;
  image: string;
}

const TYPING_DELAY_MS = 250;
const field = "h-9 rounded-md border bg-background px-3 text-sm";
const EMPTY: FilterState = { q: "", category: "", color: "", status: "", image: "" };

function same(a: FilterState, b: FilterState): boolean {
  return a.q === b.q && a.category === b.category && a.color === b.color && a.status === b.status && a.image === b.image;
}

/**
 * Filters for the product list: style SKU, category code, colour, active state and photo. The list updates as you type
 * or choose: the page address changes and the server sends the new rows, with no Apply button and no full reload.
 * Typing waits a moment so each key is not a request.
 */
export function ProductFilters({ q, category, color, status, image, categories, colors }: ProductFiltersProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FilterState>({ q, category, color, status, image });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The address this component last asked for. A different address from outside (Back, a link) replaces the fields.
  const requested = useRef<FilterState>({ q, category, color, status, image });

  useEffect(() => {
    const incoming = { q, category, color, status, image };
    if (!same(incoming, requested.current)) {
      requested.current = incoming;
      setState(incoming);
    }
  }, [q, category, color, status, image]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function navigate(next: FilterState): void {
    requested.current = next;
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.category) params.set("category", next.category);
    if (next.color) params.set("color", next.color);
    if (next.status) params.set("status", next.status);
    if (next.image) params.set("image", next.image);
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function change(patch: Partial<FilterState>, wait: boolean): void {
    const next = { ...state, ...patch };
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    if (wait) timer.current = setTimeout(() => navigate(next), TYPING_DELAY_MS);
    else navigate(next);
  }

  const active = !same(state, EMPTY);

  return (
    <div className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-[1fr_190px_190px_130px_130px_auto] md:items-end" role="search">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("products.filterStyle")}</span>
        <span className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={state.q}
            onChange={(event) => change({ q: event.target.value }, true)}
            placeholder={t("products.stylePlaceholder")}
            className={`${field} w-full pl-9 font-mono`}
            autoComplete="off"
            spellCheck={false}
          />
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("products.filterCategoryCode")}</span>
        <select value={state.category} onChange={(event) => change({ category: event.target.value }, false)} className={field}>
          <option value="">{t("products.codeAll")}</option>
          {categories.map((row) => (
            <option key={row.code} value={row.code}>
              {row.code} · {localizedName(locale, row.name, row.nameTh)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("products.filterColor")}</span>
        <select value={state.color} onChange={(event) => change({ color: event.target.value }, false)} className={field}>
          <option value="">{t("products.colorAll")}</option>
          {colors.map((row) => (
            <option key={row.code} value={row.code}>
              {row.code} · {localizedName(locale, row.name, row.nameTh)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("sales.status")}</span>
        <select value={state.status} onChange={(event) => change({ status: event.target.value }, false)} className={field}>
          <option value="">{t("products.statusAll")}</option>
          <option value="active">{t("products.statusActive")}</option>
          <option value="inactive">{t("products.statusInactive")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("products.filterPhoto")}</span>
        <select value={state.image} onChange={(event) => change({ image: event.target.value }, false)} className={field}>
          <option value="">{t("products.photoAny")}</option>
          <option value="missing">{t("products.photoMissing")}</option>
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!active}
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setState(EMPTY);
            navigate(EMPTY);
          }}
          className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50"
        >
          {t("inventory.reset")}
        </button>
        <span aria-live="polite" className="flex h-9 w-24 items-center gap-1 text-xs text-muted-foreground">
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> {t("products.updating")}
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
