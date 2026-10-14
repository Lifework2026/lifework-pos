import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bangkokDayRange, bangkokStamp, bangkokYmd, isYmd } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

interface ShiftsPageProps {
  searchParams: { from?: string; to?: string; status?: string; flag?: string; user?: string; page?: string };
}

function daysAgo(days: number): string {
  return bangkokYmd(new Date(Date.now() - days * 86_400_000));
}

const baht = (value: Prisma.Decimal | null) => (value === null ? "—" : formatBaht(Number(value.toFixed(2))));

/** Shift reports for manager review: each drawer's float, expected cash, counted cash and the over/short. */
export default async function ShiftsPage({ searchParams }: ShiftsPageProps) {
  const t = serverT(getServerLocale());
  const today = bangkokYmd();
  const from = isYmd(searchParams.from) ? searchParams.from : daysAgo(13);
  const to = isYmd(searchParams.to) && searchParams.to >= from ? searchParams.to : today > from ? today : from;
  const status = searchParams.status === "OPEN" || searchParams.status === "CLOSED" ? searchParams.status : undefined;
  const flag = searchParams.flag === "variance" || searchParams.flag === "unreviewed" ? searchParams.flag : undefined;
  const userId = searchParams.user || undefined;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(searchParams.page ?? "1", 10) || 1));

  const where: Prisma.ShiftWhereInput = {
    openedAt: { gte: bangkokDayRange(from).start, lt: bangkokDayRange(to).end },
    ...(status ? { status } : {}),
    ...(userId ? { userId } : {}),
    ...(flag === "variance" ? { status: "CLOSED", NOT: { variance: 0 } } : {}),
    ...(flag === "unreviewed" ? { status: "CLOSED", reviewedAt: null } : {}),
  };

  const [shifts, total, users, openCount, unreviewedCount, agg] = await Promise.all([
    prisma.shift.findMany({
      where,
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, status: true, openedAt: true, closedAt: true, openingFloat: true, expectedCash: true, countedCash: true, variance: true,
        reviewedAt: true, user: { select: { fullName: true, username: true } },
      },
    }),
    prisma.shift.count({ where }),
    prisma.user.findMany({ select: { id: true, fullName: true, username: true }, orderBy: { fullName: "asc" } }),
    prisma.shift.count({ where: { status: "OPEN" } }),
    prisma.shift.count({ where: { status: "CLOSED", reviewedAt: null } }),
    prisma.shift.aggregate({ where: { ...where, status: "CLOSED" }, _sum: { variance: true }, _count: { _all: true } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const params = new URLSearchParams({ from, to });
  if (status) params.set("status", status);
  if (flag) params.set("flag", flag);
  if (userId) params.set("user", userId);
  const pageHref = (target: number) => `/admin/shifts?${params.toString()}&page=${target}`;
  const exportHref = (format: "csv" | "xlsx") => `/api/admin/export?kind=shifts&format=${format}&from=${from}&to=${to}`;
  const fieldClass = "h-9 rounded-md border bg-background px-3";
  const netVariance = Number(agg._sum.variance?.toFixed(2) ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("shifts.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("shifts.desc")}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">{t("shifts.openNow")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{openCount}</p>
        </div>
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">{t("shifts.awaitingReview")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {unreviewedCount}
            {unreviewedCount > 0 ? (
              <Link href="/admin/shifts?flag=unreviewed&from=2020-01-01" className="ml-2 text-sm font-normal underline">
                {t("shifts.show")}
              </Link>
            ) : null}
          </p>
        </div>
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">{t("shifts.netVariance", { count: agg._count._all })}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${netVariance < 0 ? "text-red-700" : netVariance > 0 ? "text-amber-700" : ""}`}>
            {netVariance > 0 ? "+" : ""}
            {formatBaht(netVariance)}
          </p>
        </div>
      </section>

      <form className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.from")}</span>
          <input type="date" name="from" defaultValue={from} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.to")}</span>
          <input type="date" name="to" defaultValue={to} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("shifts.status")}</span>
          <select name="status" defaultValue={status ?? ""} className={fieldClass}>
            <option value="">{t("inventory.filterAll")}</option>
            <option value="OPEN">{t("shifts.statusOpen")}</option>
            <option value="CLOSED">{t("shifts.statusClosed")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("shifts.flag")}</span>
          <select name="flag" defaultValue={flag ?? ""} className={fieldClass}>
            <option value="">{t("inventory.filterAll")}</option>
            <option value="variance">{t("shifts.flagVariance")}</option>
            <option value="unreviewed">{t("shifts.flagUnreviewed")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("shifts.cashier")}</span>
          <select name="user" defaultValue={userId ?? ""} className={fieldClass}>
            <option value="">{t("ledger.allStaff")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("ledger.apply")}
          </button>
          <Link href="/admin/shifts" className="flex h-9 items-center rounded-md border px-4 text-sm hover:bg-muted">
            {t("inventory.reset")}
          </Link>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">{t("shifts.showing", { total, page, pages })}</p>
        <div className="flex gap-2">
          <a href={exportHref("xlsx")} className="rounded-md border px-3 py-1.5 hover:bg-muted">
            {t("export.excel")}
          </a>
          <a href={exportHref("csv")} className="rounded-md border px-3 py-1.5 hover:bg-muted">
            {t("export.csv")}
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[980px] text-sm">
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
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {shifts.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  {t("shifts.none")}
                </td>
              </tr>
            ) : null}
            {shifts.map((shift) => {
              const variance = shift.variance === null ? null : Number(shift.variance.toFixed(2));
              return (
                <tr key={shift.id} className={`border-t ${variance !== null && variance !== 0 ? (variance < 0 ? "bg-red-50" : "bg-amber-50") : ""}`}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{shift.user.fullName}</p>
                    <p className="text-xs text-muted-foreground">{shift.user.username}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">{bangkokStamp(shift.openedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">{shift.closedAt ? bangkokStamp(shift.closedAt) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{baht(shift.openingFloat)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{baht(shift.expectedCash)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{baht(shift.countedCash)}</td>
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${variance === null || variance === 0 ? "" : variance < 0 ? "text-red-700" : "text-amber-700"}`}>
                    {variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatBaht(variance)}`}
                  </td>
                  <td className="px-4 py-2">
                    {shift.status === "OPEN" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">{t("shifts.statusOpen")}</span>
                    ) : shift.reviewedAt ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">{t("shifts.reviewed")}</span>
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{t("shifts.needsReview")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/shifts/${shift.id}`} className="rounded-md border px-3 py-1 text-xs hover:bg-muted">
                      {t("shifts.details")}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              {t("ledger.prev")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              {t("ledger.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
