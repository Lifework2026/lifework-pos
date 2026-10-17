import { isValidBarcode } from "@/lib/barcode-rules";
import { thaiToEnglish } from "@/lib/keyboard/thai-keymap";

/**
 * Decides what to do when Enter is pressed in the POS barcode field. Client-safe and pure.
 *
 * A scanner fills the field and presses Enter within a fraction of a second. A person typing a code, or a product name,
 * takes much longer. Both can be a barcode lookup, but only a scan should complain loudly when the code is unknown.
 */

/** Time from the first key to Enter within which the input counts as a scan. Scanners finish in well under 200 ms. */
export const SCAN_WINDOW_MS = 400;

export interface ScanDecision {
  /** The code to look up, with Thai layout characters mapped back to the keys that were pressed. */
  barcode: string;
  /** True when the field text had to be converted from the Thai layout. */
  converted: boolean;
  /** True when the whole text arrived within SCAN_WINDOW_MS, which means a scanner, not a person. */
  fast: boolean;
}

/**
 * Returns the lookup to run, or null when the text is not shaped like a barcode (so normal product search carries on).
 * elapsedMs is the time from the first key typed into the empty field to Enter, or null when it is not known.
 */
export function resolveScan(raw: string, elapsedMs: number | null, windowMs: number = SCAN_WINDOW_MS): ScanDecision | null {
  const text = raw.trim();
  if (text === "") return null;
  const barcode = thaiToEnglish(text).trim();
  if (!isValidBarcode(barcode)) return null;
  return { barcode, converted: barcode !== text, fast: elapsedMs !== null && elapsedMs <= windowMs };
}
