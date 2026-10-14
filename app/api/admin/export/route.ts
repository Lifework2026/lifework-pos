import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { bangkokYmd, isYmd } from "@/lib/bangkok";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-labels";
import {
  bangkokTime,
  buildSummary,
  customRange,
  loadPayments,
  loadRefunds,
  loadVoids,
  thb,
  toCsv,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

const KINDS = ["payments", "refunds", "voids", "summary"] as const;

/**
 * GET /api/admin/export?kind=payments|refunds|voids|summary&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Downloads a CSV for bank-statement matching and month-end reconciliation. Times are Bangkok time.
 * Voided sales are excluded from payments and summary, and appear in the voids file.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (session.role === "CASHIER") return apiError(403, "FORBIDDEN", "Manager access required.");

  const kind = request.nextUrl.searchParams.get("kind") ?? "";
  if (!(KINDS as readonly string[]).includes(kind)) {
    return apiError(400, "INVALID_KIND", "Choose payments, refunds, voids or summary.");
  }

  const today = bangkokYmd();
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = isYmd(fromParam) ? fromParam : today;
  const to = isYmd(toParam) ? toParam : from;
  if (from > to) return apiError(400, "INVALID_RANGE", "The start date must be on or before the end date.");
  if (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 366 * 86_400_000) {
    return apiError(400, "RANGE_TOO_LONG", "Export at most one year at a time.");
  }

  const range = customRange(from, to);
  let csv: string;
  let name: string;

  if (kind === "payments") {
    const rows = await loadPayments(range);
    csv = toCsv(
      [
        "Date", "Time", "Receipt No", "Order status", "Payment channel", "Amount (THB)", "Tendered (THB)",
        "Change (THB)", "Reference", "Card transaction ref", "Approval code", "Card", "Cashier", "Member phone",
      ],
      rows.map((r) => [
        bangkokYmd(r.paidAt), bangkokTime(r.paidAt), r.receiptNo, r.orderStatus,
        PAYMENT_METHOD_LABELS[r.method] ?? r.method, thb(r.amount),
        r.tendered === null ? null : thb(r.tendered), r.changeGiven === null ? null : thb(r.changeGiven),
        r.reference, r.transactionRef, r.approvalCode, r.cardMask, r.cashier, r.memberPhone,
      ]),
    );
    name = "payments";
  } else if (kind === "refunds") {
    const rows = await loadRefunds(range);
    csv = toCsv(
      ["Date", "Time", "Receipt No", "Refund ID", "Refund channel", "Amount (THB)", "Reference", "Reason", "Items", "Staff"],
      rows.map((r) => [
        bangkokYmd(r.refundedAt), bangkokTime(r.refundedAt), r.receiptNo, r.refundId,
        PAYMENT_METHOD_LABELS[r.method] ?? r.method, thb(r.amount), r.reference, r.reason, r.items, r.staff,
      ]),
    );
    name = "refunds";
  } else if (kind === "voids") {
    const rows = await loadVoids(range);
    csv = toCsv(
      ["Date", "Time", "Receipt No", "Voided amount (THB)", "Original payment channels", "Reason", "Staff"],
      rows.map((r) => [bangkokYmd(r.voidedAt), bangkokTime(r.voidedAt), r.receiptNo, thb(r.amount), r.channels, r.reason, r.staff]),
    );
    name = "voids";
  } else {
    const summary = await buildSummary(range);
    csv = toCsv(
      ["Payment channel", "Sales count", "Sales (THB)", "Refunds (THB)", "Net (THB)"],
      [
        ...summary.channels.map((c) => [c.label, c.salesCount, thb(c.sales), thb(c.refunds), thb(c.net)]),
        ["TOTAL", summary.totals.saleCount, thb(summary.totals.sales), thb(summary.totals.refunds), thb(summary.totals.net)],
      ],
    );
    name = "summary";
  }

  const filename = `lifework-${name}-${from}${from === to ? "" : `_to_${to}`}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
