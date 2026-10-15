import { prisma } from "@/lib/prisma";
import { buildSummary, customRange, type PeriodSummary } from "@/lib/reports";
import { vatFromInclusiveSatang, VAT_PERCENT } from "@/lib/tax-rules";
import { bangkokStamp } from "@/lib/bangkok";

/**
 * End-of-day (Z-report) figures for one store day. Money is in satang.
 *
 * Sales come from the same rows as the dashboard, so the Z-report agrees with it. Voided bills are excluded from
 * sales and listed separately. VAT is taken out of the net sales, which assumes shelf prices include VAT.
 * Over and short are the cash-count differences of the shifts closed on that day.
 */

export interface EodShiftRow {
  id: string;
  cashier: string;
  openedAt: string;
  closedAt: string | null;
  reviewed: boolean;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
  note: string | null;
}

export interface EodReport {
  date: string;
  grossSales: number;
  refunds: number;
  netSales: number;
  vat: number;
  vatPercent: number;
  cash: number;
  card: number;
  otherChannels: number;
  receipts: number;
  voidCount: number;
  voidAmount: number;
  taxInvoices: number;
  shiftsClosed: number;
  over: number;
  short: number;
  netVariance: number;
  openShifts: number;
  shifts: EodShiftRow[];
  /** True when every shift of the day is closed. The day should not be filed until it is. */
  readyToFile: boolean;
}

export interface EodInputs {
  date: string;
  summary: Pick<PeriodSummary, "channels" | "totals">;
  shifts: EodShiftRow[];
  openShifts: number;
  taxInvoices: number;
}

/** Pure: builds the Z-report from the day's sales summary and shift rows. Testable without a database. */
export function buildEodReport(input: EodInputs): EodReport {
  const cashChannel = input.summary.channels.find((c) => c.method === "CASH");
  const cardChannel = input.summary.channels.find((c) => c.method === "CARD");
  const cash = cashChannel?.net ?? 0;
  const card = cardChannel?.net ?? 0;
  const netSales = input.summary.totals.net;
  const otherChannels = netSales - cash - card;

  const variances = input.shifts.filter((s) => s.variance !== null).map((s) => s.variance as number);
  const over = variances.filter((v) => v > 0).reduce((sum, v) => sum + v, 0);
  const short = variances.filter((v) => v < 0).reduce((sum, v) => sum - v, 0);

  return {
    date: input.date,
    grossSales: input.summary.totals.sales,
    refunds: input.summary.totals.refunds,
    netSales,
    vat: vatFromInclusiveSatang(netSales),
    vatPercent: VAT_PERCENT,
    cash,
    card,
    otherChannels,
    receipts: input.summary.totals.saleCount,
    voidCount: input.summary.totals.voidCount,
    voidAmount: input.summary.totals.voidAmount,
    taxInvoices: input.taxInvoices,
    shiftsClosed: input.shifts.filter((s) => s.closedAt !== null).length,
    over,
    short,
    netVariance: over - short,
    openShifts: input.openShifts,
    shifts: input.shifts,
    readyToFile: input.openShifts === 0,
  };
}

/** Loads the day's figures from the database and builds the Z-report. */
export async function buildEod(date: string): Promise<EodReport> {
  const range = customRange(date, date);
  const [summary, closed, openShifts, taxInvoices] = await Promise.all([
    buildSummary(range),
    prisma.shift.findMany({
      where: { closedAt: { gte: range.start, lt: range.end } },
      orderBy: { closedAt: "asc" },
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        reviewedAt: true,
        openingFloat: true,
        expectedCash: true,
        countedCash: true,
        variance: true,
        closeNote: true,
        user: { select: { fullName: true } },
      },
    }),
    prisma.shift.count({ where: { status: "OPEN", openedAt: { lt: range.end } } }),
    prisma.order.count({ where: { taxInvoiceAt: { gte: range.start, lt: range.end } } }),
  ]);

  const toSatang = (value: { toNumber: () => number } | null) => (value === null ? null : Math.round(value.toNumber() * 100));
  const shifts: EodShiftRow[] = closed.map((shift) => ({
    id: shift.id,
    cashier: shift.user.fullName,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    reviewed: shift.reviewedAt !== null,
    openingFloat: Math.round(shift.openingFloat.toNumber() * 100),
    expectedCash: toSatang(shift.expectedCash),
    countedCash: toSatang(shift.countedCash),
    variance: toSatang(shift.variance),
    note: shift.closeNote,
  }));

  return buildEodReport({ date, summary, shifts, openShifts, taxInvoices });
}

/** Excel/CSV rows for the accounting department: the day's figures, then one row per closed shift. */
export function eodExport(report: EodReport): { header: string[]; rows: (string | number | null)[][]; textColumns: number[] } {
  const money = (satang: number) => (satang / 100).toFixed(2);
  const header = [
    "Item / Shift",
    "Amount (THB)",
    "Cashier",
    "Opened",
    "Closed",
    "Opening float (THB)",
    "Expected cash (THB)",
    "Counted cash (THB)",
    "Over / short (THB)",
    "Reviewed",
    "Note",
  ];
  const summaryRows: (string | number | null)[][] = [
    ["Date", report.date],
    ["Gross sales", money(report.grossSales)],
    ["Refunds", money(report.refunds)],
    ["Net sales", money(report.netSales)],
    [`VAT included in net sales (${report.vatPercent}%)`, money(report.vat)],
    ["Cash (net)", money(report.cash)],
    ["Card (net)", money(report.card)],
    ["Other channels (net)", money(report.otherChannels)],
    ["Receipts", report.receipts],
    ["Voided bills", report.voidCount],
    ["Voided amount", money(report.voidAmount)],
    ["Full tax invoices issued", report.taxInvoices],
    ["Shifts closed", report.shiftsClosed],
    ["Over (total)", money(report.over)],
    ["Short (total)", money(report.short)],
    ["Net over / short", money(report.netVariance)],
    ["Open shifts", report.openShifts],
    ["Ready to file", report.readyToFile ? "Yes" : "No"],
  ].map((row) => [row[0], row[1], null, null, null, null, null, null, null, null, null]);

  const shiftRows = report.shifts.map((shift) => [
    `Shift ${shift.id.slice(-6)}`,
    null,
    shift.cashier,
    bangkokStamp(new Date(shift.openedAt)),
    shift.closedAt ? bangkokStamp(new Date(shift.closedAt)) : null,
    money(shift.openingFloat),
    shift.expectedCash === null ? null : money(shift.expectedCash),
    shift.countedCash === null ? null : money(shift.countedCash),
    shift.variance === null ? null : money(shift.variance),
    shift.reviewed ? "Yes" : "No",
    shift.note,
  ]);

  return {
    header,
    rows: [...summaryRows, [null, null, null, null, null, null, null, null, null, null, null], ...shiftRows],
    textColumns: [0],
  };
}

