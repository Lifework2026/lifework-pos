/**
 * Catalog codes for master data (categories and colours). Client-safe.
 * A code is what spreadsheets use to name a category or colour, so it must be exact: upper-case letters,
 * digits and dashes. Lower-case input is converted to upper case before it is checked and stored.
 */

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export const CODE_RULE_MESSAGE = "Code must be 2 to 20 letters or digits, for example 00 or BK. Keep the leading zero, such as 00.";

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}
