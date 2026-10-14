import { translate, type Locale, type MessageKey } from "@/lib/i18n/messages";

/** English channel names. Used by exports and reports, which stay in English for accounting. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Credit / EDC",
  QR_PROMPTPAY: "PromptPay QR",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

const METHOD_KEYS: Record<string, MessageKey> = {
  CASH: "method.cash",
  CARD: "method.card",
  QR_PROMPTPAY: "method.qr",
  BANK_TRANSFER: "method.bank",
  OTHER: "method.other",
};

/** Channel name for screens and receipts, in the chosen language. */
export function paymentLabel(method: string, locale: Locale = "en"): string {
  const key = METHOD_KEYS[method];
  return key ? translate(locale, key) : method;
}

/** Thai name when one is set, otherwise the English name. */
export function localizedName(locale: Locale, name: string, nameTh: string | null | undefined): string {
  return locale === "th" && nameTh ? nameTh : name;
}
