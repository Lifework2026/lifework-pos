import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, translate, type Locale, type MessageKey } from "@/lib/i18n/messages";

/** Language for this request, from the locale cookie. Server components and route handlers only. */
export function getServerLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Translator bound to one locale, for server-rendered pages. */
export function serverT(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
