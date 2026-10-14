/**
 * Reading and writing spreadsheet data: CSV and .xlsx. Server-side only (xlsx uses exceljs).
 * Everything is exchanged as a table of strings, so the importers do their own typing and validation.
 */

const MAX_COLUMNS = 40;

/** Picks the delimiter that appears most in the header line. Excel in some locales saves CSV with ";" or tabs. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/**
 * Parses CSV (RFC 4180): quoted fields, escaped quotes, embedded line breaks, CRLF/LF/CR, and a UTF-8 BOM.
 * Rows where every cell is blank are dropped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value.trim() !== "")) rows.push(row.slice(0, MAX_COLUMNS).map((value) => value.trim()));
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

type XlsxCell = unknown;

/** Turns any exceljs cell value (number, date, formula, rich text, hyperlink) into plain text. */
function cellToString(value: XlsxCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) return cellToString(record.result);
    if (Array.isArray(record.richText)) {
      return (record.richText as { text?: string }[]).map((part) => part.text ?? "").join("").trim();
    }
    if (typeof record.text === "string") return record.text.trim();
    if ("error" in record) return "";
  }
  return "";
}

/** Reads the first worksheet of an .xlsx file as a table of strings. */
export async function parseXlsx(data: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as XlsxCell[]).slice(1, MAX_COLUMNS + 1);
    const cells = Array.from({ length: values.length }, (_unused, index) => cellToString(values[index]));
    if (cells.some((value) => value !== "")) rows.push(cells);
  });
  return rows;
}

export interface XlsxOptions {
  /** Zero-based columns to store as text, so Excel keeps leading zeros in barcodes and SKUs. */
  textColumns?: number[];
  widths?: number[];
}

/** Builds an .xlsx file with a bold, frozen header row. */
export async function buildXlsx(
  sheetName: string,
  header: string[],
  rows: (string | number | null)[][],
  options: XlsxOptions = {},
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Lifework POS";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });

  sheet.columns = header.map((title, index) => ({
    header: title,
    key: `c${index}`,
    width: options.widths?.[index] ?? Math.max(12, Math.min(40, title.length + 4)),
    style: options.textColumns?.includes(index) ? { numFmt: "@" } : {},
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(row.map((value) => (value === null ? "" : value)));
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/**
 * Spreadsheet apps run text that starts with = + - or @ as a formula, so a product or member name like
 * =HYPERLINK(...) typed into the app could attack whoever opens an export. A leading apostrophe makes it
 * plain text. Plain negative numbers such as "-100.50" are left alone so amounts still sum.
 */
export function neutralizeFormula(text: string): string {
  const first = text.charCodeAt(0);
  // = + - @ tab carriage-return
  if (![61, 43, 45, 64, 9, 13].includes(first)) return text;
  if (/^-[0-9]+([.][0-9]+)?$/.test(text)) return text;
  return "'" + text;
}

/** One CSV-safe line per row. Values are quoted when needed, and formula-looking text is neutralised. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return "";
    const text = typeof value === "string" ? neutralizeFormula(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(escape).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
