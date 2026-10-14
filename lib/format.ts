/** Client-safe formatting helpers. No server-only imports here. */

const bahtFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBaht(value: number): string {
  return bahtFormatter.format(value);
}

/** Parses a money string from the API ("890.00") into a number. */
export function parseMoney(value: string): number {
  return Number(value);
}
