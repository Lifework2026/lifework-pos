import { prisma } from "@/lib/prisma";
import { bangkokDayRange } from "@/lib/bangkok";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-labels";
import { satangToDecimal } from "@/lib/pricing";

/**
 * Sales, refund and void data for dashboards and CSV exports. Both read the same rows,
 * so the dashboard totals and the exported files always agree.
 */

export type ReportPeriod = "day" | "month";

export interface DateRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

const BANGKOK_OFFSET = "+07:00";

/** First calendar day of the month in store time, and the first day after it. */
function monthRange(ym: string): DateRange {
  const [year, month] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const toExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const start = new Date(`${from}T00:00:00${BANGKOK_OFFSET}`);
  const end = new Date(`${toExclusive}T00:00:00${BANGKOK_OFFSET}`);
  const lastDay = new Date(end.getTime() - 1).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  return { from, to: lastDay, start, end };
}

export function periodRange(period: ReportPeriod, anchor: string): DateRange {
  if (period === "month") return monthRange(anchor.slice(0, 7));
  const day = bangkokDayRange(anchor);
  return { from: anchor, to: anchor, start: day.start, end: day.end };
}

/** Inclusive range between two store-time days. */
export function customRange(from: string, to: string): DateRange {
  const first = bangkokDayRange(from);
  const last = bangkokDayRange(to);
  return { from, to, start: first.start, end: last.end };
}

export interface PaymentRow {
  paidAt: Date;
  receiptNo: string;
  orderStatus: string;
  method: string;
  amount: number;
  tendered: number | null;
  changeGiven: number | null;
  reference: string | null;
  transactionRef: string | null;
  approvalCode: string | null;
  cardMask: string | null;
  cashier: string;
  memberPhone: string | null;
}

export interface RefundRow {
  refundedAt: Date;
  receiptNo: string;
  refundId: string;
  method: string;
  amount: number;
  reference: string | null;
  reason: string;
  staff: string;
  items: string;
}

export interface VoidRow {
  voidedAt: Date;
  receiptNo: string;
  amount: number;
  reason: string;
  staff: string;
  channels: string;
}

const toSatang = (value: { toNumber(): number } | number | null): number =>
  value === null ? 0 : Math.round((typeof value === "number" ? value : value.toNumber()) * 100);

export async function loadPayments(range: DateRange): Promise<PaymentRow[]> {
  const rows = await prisma.payment.findMany({
    where: {
      createdAt: { gte: range.start, lt: range.end },
      order: { status: { not: "VOIDED" } },
    },
    select: {
      createdAt: true,
      method: true,
      amount: true,
      tendered: true,
      changeGiven: true,
      reference: true,
      edcPayment: { select: { transactionRef: true, approvalCode: true, cardMask: true } },
      order: {
        select: {
          receiptNo: true,
          status: true,
          cashier: { select: { fullName: true } },
          member: { select: { phone: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    paidAt: row.createdAt,
    receiptNo: row.order.receiptNo,
    orderStatus: row.order.status,
    method: row.method,
    amount: toSatang(row.amount),
    tendered: row.tendered === null ? null : toSatang(row.tendered),
    changeGiven: row.changeGiven === null ? null : toSatang(row.changeGiven),
    reference: row.reference,
    transactionRef: row.edcPayment?.transactionRef ?? null,
    approvalCode: row.edcPayment?.approvalCode ?? null,
    cardMask: row.edcPayment?.cardMask ?? null,
    cashier: row.order.cashier.fullName,
    memberPhone: row.order.member?.phone ?? null,
  }));
}

export async function loadRefunds(range: DateRange): Promise<RefundRow[]> {
  const rows = await prisma.refundLine.findMany({
    where: { createdAt: { gte: range.start, lt: range.end } },
    select: {
      method: true,
      amount: true,
      reference: true,
      createdAt: true,
      refund: {
        select: {
          id: true,
          reason: true,
          order: { select: { receiptNo: true } },
          createdBy: { select: { fullName: true } },
          items: { select: { quantity: true, orderItem: { select: { sku: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    refundedAt: row.createdAt,
    receiptNo: row.refund.order.receiptNo,
    refundId: row.refund.id,
    method: row.method,
    amount: toSatang(row.amount),
    reference: row.reference,
    reason: row.refund.reason,
    staff: row.refund.createdBy?.fullName ?? "",
    items: row.refund.items.map((item) => item.orderItem.sku + " x" + item.quantity).join("; "),
  }));
}

export async function loadVoids(range: DateRange): Promise<VoidRow[]> {
  const rows = await prisma.order.findMany({
    where: { status: "VOIDED", voidedAt: { gte: range.start, lt: range.end } },
    select: {
      receiptNo: true,
      totalAmount: true,
      voidReason: true,
      voidedAt: true,
      voidedBy: { select: { fullName: true } },
      payments: { select: { method: true } },
    },
    orderBy: { voidedAt: "asc" },
  });

  return rows.map((row) => ({
    voidedAt: row.voidedAt ?? new Date(0),
    receiptNo: row.receiptNo,
    amount: toSatang(row.totalAmount),
    reason: row.voidReason ?? "",
    staff: row.voidedBy?.fullName ?? "",
    channels: row.payments.map((p) => PAYMENT_METHOD_LABELS[p.method] ?? p.method).join(" + "),
  }));
}

export interface ChannelSummary {
  method: string;
  label: string;
  salesCount: number;
  sales: number;
  refunds: number;
  net: number;
}

export interface PeriodSummary {
  range: DateRange;
  channels: ChannelSummary[];
  totals: { sales: number; refunds: number; net: number; saleCount: number; voidCount: number; voidAmount: number };
}

/** Builds the sales summary by payment channel for a range. Amounts are satang. */
export async function buildSummary(range: DateRange): Promise<PeriodSummary> {
  const [payments, refunds, voids] = await Promise.all([
    loadPayments(range),
    loadRefunds(range),
    loadVoids(range),
  ]);

  const byMethod = new Map<string, ChannelSummary>();
  const channel = (method: string): ChannelSummary => {
    let entry = byMethod.get(method);
    if (!entry) {
      entry = {
        method,
        label: PAYMENT_METHOD_LABELS[method] ?? method,
        salesCount: 0,
        sales: 0,
        refunds: 0,
        net: 0,
      };
      byMethod.set(method, entry);
    }
    return entry;
  };

  for (const payment of payments) {
    const entry = channel(payment.method);
    entry.sales += payment.amount;
    entry.salesCount += 1;
  }
  for (const refund of refunds) {
    channel(refund.method).refunds += refund.amount;
  }
  const channels = Array.from(byMethod.values())
    .map((entry) => ({ ...entry, net: entry.sales - entry.refunds }))
    .sort((a, b) => b.sales - a.sales);

  const sales = channels.reduce((sum, c) => sum + c.sales, 0);
  const refundTotal = channels.reduce((sum, c) => sum + c.refunds, 0);
  const saleCount = new Set(payments.map((p) => p.receiptNo)).size;

  return {
    range,
    channels,
    totals: {
      sales,
      refunds: refundTotal,
      net: sales - refundTotal,
      saleCount,
      voidCount: voids.length,
      voidAmount: voids.reduce((sum, v) => sum + v.amount, 0),
    },
  };
}

/** One CSV-safe line per row. Values are quoted when needed. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(escape).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function thb(satang: number): string {
  return satangToDecimal(satang);
}

/** Store-time time of day, HH:MM:SS. */
export function bangkokTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour12: false });
}

