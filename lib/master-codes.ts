/**
 * Catalog codes for master data (categories and colours). Client-safe.
 * A code is what spreadsheets use to name a category or colour, so it must be exact: upper-case letters,
 * digits and dashes. Lower-case input is converted to upper case before it is checked and stored.
 */

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export const CODE_RULE_MESSAGE = "Code must be 2 to 20 letters or digits, for example 00 or 01. Keep the leading zero, such as 00.";

/** Category codes are the official two-letter dictionary keys, for example TS or BG. */
export const CATEGORY_CODE_PATTERN = /^[A-Z]{2}$/;
export const CATEGORY_CODE_MESSAGE = "Category code must be exactly 2 capital letters from the official dictionary, for example TS (Short T-Shirts) or BG (BAG).";

export function isValidCategoryCode(value: string): boolean {
  return CATEGORY_CODE_PATTERN.test(value);
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}
