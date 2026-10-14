import Link from "next/link";
import { notFound } from "next/navigation";
import { ShiftActions } from "@/components/admin/shift-actions";
import { prisma } from "@/lib/prisma";
import { bangkokStamp } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { paymentLabel } from "@/lib/payment-labels";
import { computeShiftTotals, expectedForShift, totalsFromSummary, type ShiftTotals } from "@/lib/shifts";

export const dynamic = "force-dynamic";

const METHOD_ORDER = ["CASH", "CARD", "QR_PROMPTPAY", "BANK_TRANSFER", "OTHER"] as const;
const money = (satang: number) => formatBaht(satang / 100);
const toSatang = (value: { toFixed: (digits: number) => string } | null) => (value === null ? 0 : Math.round(Number(value.toFixed(2)) * 100));

/** One shift: how the drawer is expected to reconcile, what was counted, sales by channel, and the receipts. */
export default async function ShiftDetailPage({ params }: { params: { id: string } }) {
  const locale = getServerLocale();
  const t = serverT(locale);

  const shift = await prisma.shift.findUnique({
    where: { id: params.id },
    select: {
      id: true, status: true, openedAt: true, closedAt: true, openingFloat: true, openNote: true, expectedCash: true, countedCash: true, variance: true,
      closeNote: true, summary: true, reviewedAt: true, reviewNote: true,
      user: { select: { fullName: true, username: true } },
      closedBy: { select: { fullName: true } },
      reviewedBy: { select: { fullName: true } },
    },
  });
  if (!shift) notFound();

  const open = shift.status === "OPEN";
  const floatSatang = toSatang(shift.openingFloat);
  let totals: ShiftTotals | null = open ? await computeShiftTotals(prisma, shift.id) : totalsFromSummary(shift.summary);
  if (!totals) totals = await computeShiftTotals(prisma, shift.id);

  const expected = open ? expectedForShift(floatSatang, totals) : toSatang(shift.expectedCash);
  const counted = shift.countedCash === null ? null : toSatang(shift.countedCash);
  const variance = shift.variance === null ? null : toSatang(shift.variance);

  const orders = await prisma.order.findMany({
    where: { OR: [{ shiftId: shift.id }, { voidShiftId: shift.id }] },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, receiptNo: true, createdAt: true, status: true, totalAmount: true, shiftId: true, voidShiftId: true },
  });

  const rowClass = "flex items-center justify-between gap-4 py-1.5";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/shifts" className="text-sm text-muted-foreground underline">
            {t("shifts.back")}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("shifts.detailTitle", { name: shift.user.fullName })}</h1>
          <p className="text-sm text-muted-foreground">
            {bangkokStamp(shift.openedAt)} → {shift.closedAt ? bangkokStamp(shift.closedAt) : t("shifts.stillOpen")}
          </p>
        </div>
        {open ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">{t("shifts.statusOpen")}</span>
        ) : shift.reviewedAt ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">{t("shifts.reviewed")}</span>
        ) : (
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-800">{t("shifts.needsReview")}</span>
        )}
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-background p-4">
          <h2 className="mb-2 font-semibold">{t("shifts.reconcile")}</h2>
          <div className="divide-y text-sm tabular-nums">
            <div className={rowClass}>
              <span>{t("shifts.float")}</span>
              <span>{money(floatSatang)}</span>
            </div>
            <div className={rowClass}>
              <span>+ {t("shifts.cashSales")}</span>
              <span>{money(totals.cashSales)}</span>
            </div>
            <div className={rowClass}>
              <span>− {t("shifts.cashRefunds")}</span>
              <span>{money(totals.cashRefunds)}</span>
            </div>
            <div className={rowClass}>
              <span>− {t("shifts.cashVoids")}</span>
              <span>{money(totals.cashVoids)}</span>
            </div>
            <div className={`${rowClass} font-semibold`}>
              <span>{open ? t("shifts.expectedNow") : t("shifts.expected")}</span>
              <span>{money(expected)}</span>
            </div>
            <div className={rowClass}>
              <span>{t("shifts.counted")}</span>
              <span>{counted === null ? "—" : money(counted)}</span>
            </div>
            <div className={`${rowClass} font-semibold ${variance === null || variance === 0 ? "" : variance < 0 ? "text-red-700" : "text-amber-700"}`}>
              <span>{t("shifts.variance")}</span>
              <span>
                {variance === null ? "—" : `${variance > 0 ? "+" : ""}${money(variance)}`}
                {variance !== null && variance !== 0 ? ` (${variance < 0 ? t("shifts.short") : t("shifts.over")})` : ""}
              </span>
            </div>
          </div>
          {shift.openNote ? <p className="mt-3 text-sm text-muted-foreground">{t("shifts.openNote", { note: shift.openNote })}</p> : null}
          {shift.closeNote ? <p className="mt-1 text-sm">{t("shifts.closeNote", { note: shift.closeNote })}</p> : null}
          {shift.closedBy && shift.closedBy.fullName !== shift.user.fullName ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("shifts.closedBy", { name: shift.closedBy.fullName })}</p>
          ) : null}
          {shift.reviewedAt ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("shifts.reviewedBy", { name: shift.reviewedBy?.fullName ?? "—", time: bangkokStamp(shift.reviewedAt) })}
              {shift.reviewNote ? ` · ${shift.reviewNote}` : ""}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border bg-background p-4">
          <h2 className="mb-2 font-semibold">{t("shifts.byChannel")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">{t("dash.colChannel")}</th>
                  <th className="py-1 text-right font-medium">{t("shifts.taken")}</th>
                  <th className="py-1 text-right font-medium">{t("dash.colRefunds")}</th>
                  <th className="py-1 text-right font-medium">{t("shifts.voided")}</th>
                </tr>
              </thead>
              <tbody>
                {METHOD_ORDER.map((method) => (
                  <tr key={method} className="border-t tabular-nums">
                    <td className="py-1.5">{paymentLabel(method, locale)}</td>
                    <td className="py-1.5 text-right">{money(totals.sales[method])}</td>
                    <td className="py-1.5 text-right">{totals.refunds[method] > 0 ? `-${money(totals.refunds[method])}` : "—"}</td>
                    <td className="py-1.5 text-right">{totals.voids[method] > 0 ? `-${money(totals.voids[method])}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("shifts.receiptsSummary", { count: totals.orderCount - totals.voidedCount, voided: totals.voidedCount, total: money(totals.salesTotal) })}
          </p>
        </div>
      </section>

      {open ? <ShiftActions shiftId={shift.id} mode="close" /> : null}
      {!open && !shift.reviewedAt ? <ShiftActions shiftId={shift.id} mode="review" /> : null}

      <section className="rounded-xl border bg-background">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{t("shifts.receipts")}</h2>
        </div>
        {orders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("shifts.noReceipts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("sales.colReceipt")}</th>
                  <th className="px-4 py-2 font-medium">{t("ledger.colTime")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("shifts.total")}</th>
                  <th className="px-4 py-2 font-medium">{t("shifts.status")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t">
                    <td className="px-4 py-2 font-mono text-xs">{order.receiptNo}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">{bangkokStamp(order.createdAt)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBaht(Number(order.totalAmount.toFixed(2)))}</td>
                    <td className="px-4 py-2 text-xs">
                      {order.status}
                      {order.voidShiftId === shift.id && order.shiftId !== shift.id ? ` · ${t("shifts.voidedHere")}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
