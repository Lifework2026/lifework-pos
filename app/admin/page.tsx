import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { bangkokYmd, isYmd } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { paymentLabel } from "@/lib/payment-labels";
import { buildSummary, periodRange, type ReportPeriod } from "@/lib/reports";
import { satangToDecimal } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const LOW_STOCK_THRESHOLD = 3;

interface DashboardProps {
  searchParams: { period?: string; date?: string };
}

const money = (satang: number) => formatBaht(Number(satangToDecimal(satang)));

/**
 * Sales dashboard by payment channel, for a store day or a calendar month (Bangkok time).
 * Voids are excluded from sales. Refunds reduce the channel they were paid out through.
 */
export default async function AdminDashboardPage({ searchParams }: DashboardProps) {
  const locale = getServerLocale();
  const t = serverT(locale);
  const period: ReportPeriod = searchParams.period === "month" ? "month" : "day";
  const today = bangkokYmd();
  const requested = isYmd(searchParams.date) ? searchParams.date : today;
  const anchor = period === "month" ? `${requested.slice(0, 7)}-01` : requested;

  const range = periodRange(period, anchor);
  const [summary, lowStockCount, outOfStockCount] = await Promise.all([
    buildSummary(range),
    prisma.productVariant.count({ where: { isActive: true, stockQuantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } } }),
    prisma.productVariant.count({ where: { isActive: true, stockQuantity: { lte: 0 } } }),
  ]);

  const exportLink = (kind: string) => `/api/admin/export?kind=${kind}&from=${range.from}&to=${range.to}`;
  const periodLabel = period === "month" ? range.from.slice(0, 7) : range.from;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("dash.period", { period: period === "month" ? t("dash.month") : t("dash.day"), range: periodLabel })} · {range.from}{" "}
            - {range.to} {t("dash.bangkokTime")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-md border p-1 text-sm">
            <Link
              href={`/admin?period=day&date=${requested}`}
              className={`rounded px-3 py-1.5 ${period === "day" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {t("dash.daily")}
            </Link>
            <Link
              href={`/admin?period=month&date=${requested}`}
              className={`rounded px-3 py-1.5 ${period === "month" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {t("dash.monthly")}
            </Link>
          </div>
          <form className="flex items-end gap-2">
            <input type="hidden" name="period" value={period} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{period === "month" ? t("dash.anyDayInMonth") : t("dash.day")}</span>
              <input type="date" name="date" defaultValue={requested} className="h-9 rounded-md border bg-background px-3" />
            </label>
            <button type="submit" className="h-9 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">
              {t("dash.show")}
            </button>
          </form>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("dash.netSales")}
          value={money(summary.totals.net)}
          hint={t("dash.soldMinusRefunded", { sold: money(summary.totals.sales), refunded: money(summary.totals.refunds) })}
        />
        <StatCard label={t("dash.receipts")} value={String(summary.totals.saleCount)} hint={t("dash.receiptsHint")} />
        <StatCard label={t("dash.refunds")} value={money(summary.totals.refunds)} />
        <StatCard
          label={t("dash.voids")}
          value={String(summary.totals.voidCount)}
          hint={summary.totals.voidCount > 0 ? t("dash.voidedAmount", { amount: money(summary.totals.voidAmount) }) : undefined}
        />
      </section>

      <section className="rounded-xl border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="font-semibold">{t("dash.channels")}</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={exportLink("summary")} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              {t("dash.csvSummary")}
            </a>
            <a href={exportLink("payments")} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              {t("dash.csvPayments")}
            </a>
            <a href={exportLink("refunds")} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              {t("dash.csvRefunds")}
            </a>
            <a href={exportLink("voids")} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              {t("dash.csvVoids")}
            </a>
          </div>
        </div>
        {summary.channels.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("dash.noSales")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("dash.colChannel")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("dash.colPayments")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("dash.colSales")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("dash.colRefunds")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("dash.colNet")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("dash.colShare")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.channels.map((channel) => (
                  <tr key={channel.method} className="border-t">
                    <td className="px-4 py-2 font-medium">{paymentLabel(channel.method, locale)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{channel.salesCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(channel.sales)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{channel.refunds > 0 ? `-${money(channel.refunds)}` : "—"}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(channel.net)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {summary.totals.sales > 0 ? `${((channel.sales / summary.totals.sales) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-4 py-2">{t("dash.total")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{summary.channels.reduce((s, c) => s + c.salesCount, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(summary.totals.sales)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(summary.totals.refunds)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(summary.totals.net)}</td>
                  <td className="px-4 py-2 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-background p-4 text-sm">
        <p className="font-medium">{t("dash.stockAlerts")}</p>
        <p className="text-muted-foreground">
          <Link href="/admin/inventory?stock=low" className="underline">
            {t("dash.lowStock", { count: lowStockCount, threshold: LOW_STOCK_THRESHOLD })}
          </Link>
          {" · "}
          {t("dash.outOfStock", { count: outOfStockCount })}
        </p>
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
