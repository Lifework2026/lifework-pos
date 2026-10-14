/** Display names for payment methods. Client-safe. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Credit / EDC",
  QR_PROMPTPAY: "PromptPay QR",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

export function paymentLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
