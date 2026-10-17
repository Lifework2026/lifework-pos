"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";

interface ProductFiltersProps {
  q: string;
  category: string;
  status: string;
  image: string;
  categories: { code: string; name: string; nameTh: string | null }[];
}

interface FilterState {
  q: string;
  category: string;
  status: string;
  image: string;
}

const TYPING_DELAY_MS = 250;
const field = "h-9 rounded-md border bg-background px-3 text-sm";

/**
 * Filters for the product list. The list updates as you type or choose: the page address changes and the server
 * sends the new rows, with no Apply button and no full reload. Typing waits a moment so each key is not a request.
 */
export function ProductFilters({ q, category, status, image, categories }: ProductFiltersProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FilterState>({ q, category, status, image });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The address this component last asked for. A different address from outside (Back, a link) replaces the fields.
  const requested = useRef<FilterState>({ q, category, status, image });

  useEffect(() => {
    const incoming = { q, category, status, image };
    const last = requested.current;
    if (incoming.q !== last.q || incoming.category !== last.category || incoming.status !== last.status || incoming.image !== last.image) {
      requested.current = incoming;
      setState(incoming);
    }
  }, [q, category, status, image]);

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

  const active = state.q !== "" || state.category !== "" || state.status !== "" || state.image !== "";

  return (
    <div className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-[1fr_220px_150px_150px_auto] md:items-end" role="search">
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
            const empty = { q: "", category: "", status: "", image: "" };
            setState(empty);
            navigate(empty);
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
