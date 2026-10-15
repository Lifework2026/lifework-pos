import Link from "next/link";
import { buildEod } from "@/lib/eod";
import { bangkokStamp, bangkokYmd, isYmd } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

interface EodPageProps {
  searchParams: { date?: string };
}

const money = (satang: number) => formatBaht(satang / 100);

/** End-of-day (Z-report) for one store day: totals across every shift, VAT, cash and card, and the cash-count differences. */
export default async function EodPage({ searchParams }: EodPageProps) {
  const t = serverT(getServerLocale());
  const today = bangkokYmd();
  const date = isYmd(searchParams.date) ? searchParams.date : today;
  const report = await buildEod(date);
  const exportHref = (format: "csv" | "xlsx") => `/api/admin/export?kind=eod&format=${format}&from=${date}&to=${date}`;
  const linkClass = "rounded-md border px-3 py-1.5 hover:bg-muted";

  const stats: { label: string; value: string; hint?: string }[] = [
    { label: t("eod.netSales"), value: money(report.netSales), hint: t("eod.grossHint", { gross: money(report.grossSales), refunds: money(report.refunds) }) },
    { label: t("eod.vat"), value: money(report.vat), hint: t("eod.vatHint", { percent: report.vatPercent }) },
    { label: t("eod.cash"), value: money(report.cash) },
    { label: t("eod.card"), value: money(report.card), hint: report.otherChannels !== 0 ? t("eod.otherHint", { amount: money(report.otherChannels) }) : undefined },
    { label: t("eod.refunds"), value: money(report.refunds) },
    { label: t("eod.voids"), value: String(report.voidCount), hint: t("eod.voidHint", { amount: money(report.voidAmount) }) },
    { label: t("eod.taxInvoices"), value: String(report.taxInvoices) },
    {
      label: t("eod.overShort"),
      value: `${report.netVariance > 0 ? "+" : ""}${money(report.netVariance)}`,
      hint: t("eod.overShortHint", { over: money(report.over), short: money(report.short), count: report.shiftsClosed }),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("eod.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("eod.desc", { date })}</p>
        </div>
        <form className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("eod.date")}</span>
            <input type="date" name="date" defaultValue={date} max={today} className="h-9 rounded-md border bg-background px-3" />
          </label>
          <button type="submit" className="h-9 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">
            {t("dash.show")}
          </button>
        </form>
      </div>

      {report.openShifts > 0 ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">{t("eod.openWarningTitle", { count: report.openShifts })}</p>
          <p>{t("eod.openWarningBody")}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">{t("eod.readyTitle")}</p>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
            {stat.hint ? <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p> : null}
          </div>
        ))}
      </section>

      <section className="rounded-xl border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="font-semibold">{t("eod.shifts", { count: report.shifts.length })}</h2>
          <div className="flex gap-2 text-sm">
            <a href={exportHref("xlsx")} className={linkClass}>
              {t("eod.exportExcel")}
            </a>
            <a href={exportHref("csv")} className={linkClass}>
              {t("export.csv")}
            </a>
          </div>
        </div>
        {report.shifts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("eod.noShifts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("shifts.cashier")}</th>
                  <th className="px-4 py-2 font-medium">{t("shifts.opened")}</th>
                  <th className="px-4 py-2 font-medium">{t("shifts.closed")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("shifts.float")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("shifts.expected")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("shifts.counted")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("shifts.variance")}</th>
                  <th className="px-4 py-2 font-medium">{t("shifts.status")}</th>
                </tr>
              </thead>
              <tbody>
                {report.shifts.map((shift) => {
                  const variance = shift.variance ?? 0;
                  return (
                    <tr key={shift.id} className={`border-t ${variance < 0 ? "bg-red-50" : variance > 0 ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-2 font-medium">{shift.cashier}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">{bangkokStamp(new Date(shift.openedAt))}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">
                        {shift.closedAt ? bangkokStamp(new Date(shift.closedAt)) : t("shifts.stillOpen")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(shift.openingFloat)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{shift.expectedCash === null ? "—" : money(shift.expectedCash)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{shift.countedCash === null ? "—" : money(shift.countedCash)}</td>
                      <td className={`px-4 py-2 text-right font-semibold tabular-nums ${variance < 0 ? "text-red-700" : variance > 0 ? "text-amber-700" : ""}`}>
                        {shift.variance === null ? "—" : `${variance > 0 ? "+" : ""}${money(variance)}`}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {shift.closedAt ? (shift.reviewed ? t("shifts.reviewed") : t("shifts.needsReview")) : t("shifts.statusOpen")}
                        {shift.note ? <div className="text-muted-foreground">{shift.note}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-sm">
        <Link href="/admin/shifts" className="underline">
          {t("eod.toShifts")}
        </Link>
      </p>
    </div>
  );
}
