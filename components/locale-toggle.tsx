"use client";

import { useI18n } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/messages";

const LABELS: Record<Locale, string> = { th: "TH", en: "EN" };

/** TH / EN switch for the top navigation bar. */
export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("common.language")} className="inline-flex overflow-hidden rounded-md border text-xs font-semibold">
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          className={`px-2.5 py-1.5 transition-colors ${locale === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {LABELS[value]}
        </button>
      ))}
    </div>
  );
}
