/**
 * Barcode format rules shared by the product form, the product API and the spreadsheet import.
 * Client-safe: no server-only imports here.
 *
 * Barcodes are the codes printed on the goods or label at the source (for example "LW265TS99035XL")
 * or the store-issued EAN-13. Letters, digits and - . / _ are allowed. Spaces are not, because a
 * scanner would not send them as one code.
 */

export const BARCODE_MIN_LENGTH = 4;
export const BARCODE_MAX_LENGTH = 40;

const BARCODE_PATTERN = /^[A-Za-z0-9\-./_]+$/;

export function isValidBarcode(value: string): boolean {
  return value.length >= BARCODE_MIN_LENGTH && value.length <= BARCODE_MAX_LENGTH && BARCODE_PATTERN.test(value);
}

export const BARCODE_RULE_MESSAGE = `Barcode must be ${BARCODE_MIN_LENGTH} to ${BARCODE_MAX_LENGTH} letters, digits or - . / _ (no spaces).`;
