// Imports a packing-list CSV (the import template) into the catalogue, with the same checks as the admin import page.
// Several imports' worth of rows go in as ONE all-or-nothing transaction, and prices can come from a supplier sheet.
//
//   npx tsx scripts/import-packing-list.ts exports/packing-template-A-final-v3.csv --prices "LWK26-03 New.xlsx"          preview: checks and plans, writes nothing
//   npx tsx scripts/import-packing-list.ts exports/packing-template-A-final-v3.csv --prices "LWK26-03 New.xlsx" --apply  writes it
//
// The importer requires a price on every row. By default a row without one is a problem and nothing is imported. With
// --only-priced the rows without a price are set aside in exports/packing-awaiting-price.csv and the rest is imported.
//
// --prices reads PRODUCT CODE and TAG PRICE (THB) from the first sheet of an .xlsx and fills the Price of every row of
// that style whose Price is blank. A price already in the CSV is never changed, and a style that has two different prices
// in the sheet is left blank and reported.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { fillPricesByStyle, splitByPrice, splitTableByStyle } from "../lib/catalog/packing-import";
import { MAX_IMPORT_ROWS, parseImportTable, type ImportIssue, type ImportRow } from "../lib/catalog/import";
import { parseCsv } from "../lib/tabular";

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const csvPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--prices");
const pricesPath = flagValue("--prices");
const apply = args.includes("--apply");
const onlyPriced = args.includes("--only-priced");

if (!csvPath) {
  console.error('Usage: npx tsx scripts/import-packing-list.ts <file.csv> [--prices "<sheet.xlsx>"] [--apply]');
  process.exit(2);
}

const cellNumber = (value: ExcelJS.CellValue): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    return value.trim() && Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === "object" && "result" in value) return cellNumber(value.result as ExcelJS.CellValue);
  return null;
};

async function readPrices(file: string): Promise<{ prices: Map<string, number>; conflicts: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const cols = new Map<string, number>();
  // The first column with a name wins: a sheet may repeat a header further to the right.
  ws.getRow(1).eachCell((cell, i) => {
    const name = String(cell.value ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!cols.has(name)) cols.set(name, i);
  });
  const styleCol = cols.get("PRODUCT CODE");
  const priceCol = cols.get("TAG PRICE (THB)");
  if (!styleCol || !priceCol) throw new Error(`The sheet needs PRODUCT CODE and TAG PRICE (THB) columns. Found: ${Array.from(cols.keys()).join(", ")}`);
  const seen = new Map<string, Set<number>>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const style = String(ws.getRow(r).getCell(styleCol).value ?? "").trim().toUpperCase();
    const price = cellNumber(ws.getRow(r).getCell(priceCol).value);
    if (!/^[A-Z]{2}\d{3}[A-Z]{2}\d{3}$/.test(style) || price === null || price <= 0) continue;
    seen.set(style, (seen.get(style) ?? new Set<number>()).add(price));
  }
  const prices = new Map<string, number>();
  const conflicts: string[] = [];
  for (const [style, set] of Array.from(seen.entries())) {
    if (set.size === 1) prices.set(style, Array.from(set)[0]);
    else conflicts.push(`${style}: ${Array.from(set).join(" / ")}`);
  }
  return { prices, conflicts };
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");
  const { Prisma } = await import("@prisma/client");
  const { planImport, commitImport } = await import("../lib/catalog/import");

  let table = parseCsv(readFileSync(path.resolve(csvPath as string), "utf8").replace(/^﻿/, ""));
  console.log(`${csvPath}: ${table.length - 1} data rows`);

  if (pricesPath) {
    const { prices, conflicts } = await readPrices(path.resolve(pricesPath));
    const fill = fillPricesByStyle(table, prices);
    table = fill.table;
    console.log(`Prices from the sheet: ${prices.size} styles; filled ${fill.filled} rows in ${fill.styles.length} styles.`);
    if (fill.unused.length) console.log(`  styles in the sheet that the CSV does not have: ${fill.unused.join(", ")}`);
    if (fill.keptExisting) console.log(`  rows that already had a price (kept): ${fill.keptExisting}`);
    if (conflicts.length) console.log(`  left blank, two prices in the sheet: ${conflicts.join("; ")}`);
  }

  if (onlyPriced) {
    const split = splitByPrice(table);
    table = split.priced;
    const waiting = path.resolve(process.cwd(), "exports", "packing-awaiting-price.csv");
    mkdirSync(path.dirname(waiting), { recursive: true });
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const quote = (cell: string) => (/[",]/.test(cell) || cell.includes(CR) || cell.includes(LF) ? '"' + cell.split('"').join('""') + '"' : cell);
    const body = split.unpriced.map((r) => r.map(quote).join(",")).join(CR + LF);
    writeFileSync(waiting, String.fromCharCode(0xfeff) + body + CR + LF);
    console.log(`Set aside ${split.unpriced.length - 1} rows of ${split.unpricedStyles.length} styles that have no price yet: ${waiting}`);
  }

  // Parse in pieces, because one piece may hold at most MAX_IMPORT_ROWS rows, then plan and write them as one.
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  let offset = 0;
  for (const piece of splitTableByStyle(table, MAX_IMPORT_ROWS)) {
    const parsed = parseImportTable(piece);
    for (const row of parsed.rows) rows.push({ ...row, line: row.line + offset });
    for (const issue of parsed.issues) issues.push({ ...issue, line: issue.line + offset });
    if (parsed.unknownColumns.length) console.log(`  unknown columns ignored: ${parsed.unknownColumns.join(", ")}`);
    offset += piece.length - 1;
  }
  if (issues.length) {
    console.log(`The file has ${issues.length} problem(s):`);
    for (const i of issues.slice(0, 30)) console.log(`  line ${i.line}: ${i.message}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const options = { onExisting: "skip", applyStock: false } as const;
  const plan = await planImport(prisma, rows, options);
  console.log("Plan:", JSON.stringify(plan.summary));
  console.log(`  rows with a price: ${rows.filter((r) => r.priceSatang > 0).length}, without: ${rows.filter((r) => r.priceSatang === 0).length}`);
  if (plan.issues.length) {
    console.log(`The plan has ${plan.issues.length} problem(s):`);
    for (const i of plan.issues.slice(0, 30)) console.log(`  line ${i.line}: ${i.message}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (!apply) {
    console.log("\nPreview only. Run again with --apply to write it.");
    await prisma.$disconnect();
    return;
  }

  const manager = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "MANAGER"] }, isActive: true }, select: { id: true } });
  if (!manager) throw new Error("No active admin or manager account to record the import against.");
  const expected = plan.summary.newVariants;
  const summary = await prisma.$transaction(
    async (tx) => {
      const again = await planImport(tx, rows, options);
      if (again.issues.length) throw new Error(`The data changed while importing: ${again.issues[0].message}`);
      if (again.summary.newVariants !== expected) throw new Error("The catalogue changed after the check. Nothing was imported.");
      await commitImport(tx, again, manager.id, path.basename(csvPath as string));
      return again.summary;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 280_000 },
  );
  console.log("Imported:", JSON.stringify(summary));
  console.log(
    "Now in the database:",
    `${await prisma.product.count()} products, ${await prisma.productVariant.count()} variants,`,
    `${await prisma.productVariant.count({ where: { price: { gt: 0 } } })} with a price`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
