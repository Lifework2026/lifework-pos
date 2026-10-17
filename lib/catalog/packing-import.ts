/**
 * Preparing a packing-list file for import: filling prices from a supplier sheet, and splitting a file that is over the
 * per-import row limit without cutting a style in two. Pure: no files, no database.
 */

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function columnOf(header: string[], name: string): number {
  const wanted = normalizeHeader(name);
  const index = header.findIndex((cell) => normalizeHeader(cell) === wanted);
  if (index < 0) throw new Error(`The file has no "${name}" column.`);
  return index;
}

export interface PriceFill {
  table: string[][];
  /** Rows that got a price. */
  filled: number;
  /** Styles that got a price. */
  styles: string[];
  /** Styles in the price list that no row of the file uses. */
  unused: string[];
  /** Rows that already had a price and were left alone. */
  keptExisting: number;
}

/** "1790" or "1790.5" in baht, as the Price column of the import template expects. */
export function formatBaht(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Puts the price of each style on every row of that style whose Price cell is blank. A price already typed in the file is
 * never changed. The style is the Name_EN column of the template.
 */
export function fillPricesByStyle(table: string[][], prices: Map<string, number>): PriceFill {
  const header = table[0];
  const styleCol = columnOf(header, "Name_EN");
  const priceCol = columnOf(header, "Price");
  const used = new Set<string>();
  let filled = 0;
  let keptExisting = 0;
  const next = table.map((row, index) => {
    if (index === 0) return row;
    const style = (row[styleCol] ?? "").trim().toUpperCase();
    const price = prices.get(style);
    if (price === undefined) return row;
    if ((row[priceCol] ?? "").trim() !== "") {
      keptExisting++;
      return row;
    }
    const copy = row.slice();
    while (copy.length <= priceCol) copy.push("");
    copy[priceCol] = formatBaht(price);
    used.add(style);
    filled++;
    return copy;
  });
  return {
    table: next,
    filled,
    styles: Array.from(used),
    unused: Array.from(prices.keys()).filter((style) => !used.has(style)),
    keptExisting,
  };
}

/**
 * Splits a table (header plus rows) into tables of at most maxRows data rows. Rows of one style stay together when the
 * style fits; consecutive rows of the same style are kept in one piece, and a style bigger than maxRows is split as a
 * last resort. Each piece repeats the header. Concatenating the pieces' data rows gives back the original rows.
 */
export function splitTableByStyle(table: string[][], maxRows: number): string[][][] {
  if (table.length === 0) return [];
  const header = table[0];
  const styleCol = columnOf(header, "Name_EN");
  const rows = table.slice(1);
  if (rows.length === 0) return [table];

  const groups: string[][][] = [];
  let previous: string | null = null;
  for (const row of rows) {
    const style = (row[styleCol] ?? "").trim().toUpperCase();
    if (groups.length > 0 && style === previous) groups[groups.length - 1].push(row);
    else groups.push([row]);
    previous = style;
  }

  const pieces: string[][][] = [];
  let current: string[][] = [];
  const flush = () => {
    if (current.length > 0) pieces.push([header, ...current]);
    current = [];
  };
  for (const group of groups) {
    if (group.length > maxRows) {
      flush();
      for (let i = 0; i < group.length; i += maxRows) pieces.push([header, ...group.slice(i, i + maxRows)]);
      continue;
    }
    if (current.length + group.length > maxRows) flush();
    current.push(...group);
  }
  flush();
  return pieces;
}

export interface PriceSplit {
  /** The header plus every row that has a price. */
  priced: string[][];
  /** The header plus every row whose Price is blank. */
  unpriced: string[][];
  /** Styles with at least one unpriced row. */
  unpricedStyles: string[];
}

/** Separates the rows that can be imported now (the importer requires a price) from the rows still waiting for one. */
export function splitByPrice(table: string[][]): PriceSplit {
  const header = table[0];
  const styleCol = columnOf(header, "Name_EN");
  const priceCol = columnOf(header, "Price");
  const priced: string[][] = [header];
  const unpriced: string[][] = [header];
  const styles = new Set<string>();
  for (const row of table.slice(1)) {
    if ((row[priceCol] ?? "").trim() !== "") priced.push(row);
    else {
      unpriced.push(row);
      styles.add((row[styleCol] ?? "").trim().toUpperCase());
    }
  }
  return { priced, unpriced, unpricedStyles: Array.from(styles) };
}
