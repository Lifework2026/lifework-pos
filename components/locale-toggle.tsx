"use client";

import { useI18n } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

const LABELS: Record<Locale, string> = { th: "TH", en: "EN" };

/** TH / EN switch. `tone="dark"` is for a black background such as the back office sidebar. */
export function LocaleToggle({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { locale, setLocale, t } = useI18n();
  const dark = tone === "dark";
  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn("inline-flex overflow-hidden rounded-[3px] border text-xs font-bold", dark && "border-zinc-700")}
    >
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          className={cn(
            "px-2.5 py-1.5 transition-colors",
            locale === value
              ? dark
                ? "bg-white text-black"
                : "bg-primary text-primary-foreground"
              : dark
                ? "text-zinc-300 hover:bg-zinc-800"
                : "hover:bg-muted",
          )}
        >
          {LABELS[value]}
        </button>
      ))}
    </div>
  );
}
