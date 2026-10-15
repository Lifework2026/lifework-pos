/**
 * Columns that must stay text: barcodes, SKUs, catalog codes and phone numbers. Their leading zeros carry meaning
 * ("01" is a category, "0812345678" is a phone). A spreadsheet that stores one of these as a number has already
 * dropped the zeros, so the importers refuse it instead of guessing. Server-side use; pure.
 */

export const TEXT_COLUMNS = ["Barcode", "SKU", "Category_Code", "Color_Code", "Phone_Number"] as const;

/** A cell that the spreadsheet stored as a number. row is the index in the table, column is zero-based. */
export interface NumericCell {
  row: number;
  col: number;
}

function columnKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Text of one cell, whatever the reader returned. A number becomes its digits, never a rounded value; blanks become "".
 * Every parser reads cells through this, so a code is always a trimmed string.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

/**
 * Refuses numeric cells in the text columns. Each message names the column and line, and says how to fix it: format the
 * column as Text, type the code again, and import again. Header row cells are ignored.
 */
export function numericTextIssues(table: string[][], numeric: NumericCell[]): { line: number; message: string }[] {
  if (numeric.length === 0 || table.length === 0) return [];
  const textHeaders = new Map<number, string>();
  (table[0] ?? []).forEach((cell, col) => {
    const match = TEXT_COLUMNS.find((name) => columnKey(name) === columnKey(cell));
    if (match) textHeaders.set(col, match);
  });

  const issues: { line: number; message: string }[] = [];
  for (const cell of numeric) {
    if (cell.row === 0) continue;
    const column = textHeaders.get(cell.col);
    if (!column) continue;
    issues.push({
      line: cell.row + 1,
      message: `${column} "${table[cell.row]?.[cell.col] ?? ""}" was stored as a number, so leading zeros may be lost. Format the column as Text, type the code again (for example 01), and import again.`,
    });
  }
  return issues;
}
