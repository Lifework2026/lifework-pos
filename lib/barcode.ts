import { randomInt } from "crypto";

/**
 * Builds a valid EAN-13 barcode from a 12-digit base by appending the GS1 check digit.
 */
export function ean13(base12: string): string {
  if (!/^\d{12}$/.test(base12)) {
    throw new Error(`ean13 expects 12 digits, received "${base12}"`);
  }
  const sum = base12
    .split("")
    .map((d, i) => Number(d) * (i % 2 === 0 ? 1 : 3))
    .reduce((acc, n) => acc + n, 0);
  return `${base12}${(10 - (sum % 10)) % 10}`;
}

/** Random EAN-13 in the 885 prefix range used for store-issued codes. Check digit is valid. */
export function randomStoreEan13(): string {
  let base = "885";
  for (let i = 0; i < 9; i += 1) base += String(randomInt(10));
  return ean13(base);
}
