import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bangkokStamp, bangkokYmd, isYmd } from "@/lib/bangkok";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  buildLedgerWhere,
  LEDGER_PAGE_SIZE,
  MOVEMENT_TYPES,
  parseMovementType,
  parseStockReason,
  STOCK_REASONS,
} from "@/lib/ledger";
import { localizedName } from "@/lib/payment-labels";

export const dynamic = "force-dynamic";

interface LedgerPageProps {
  searchParams: { from?: string; to?: string; type?: string; reason?: string; user?: string; q?: string; page?: string };
}

const TYPE_STYLES: Record<string, string> = {
  SALE: "bg-slate-100 text-slate-800",
  RETURN: "bg-sky-100 text-sky-800",
  VOID: "bg-rose-100 text-rose-800",
  STOCK_IN: "bg-emerald-100 text-emerald-800",
  ADJUSTMENT: "bg-amber-100 text-amber-900",
};

function daysAgo(days: number): string {
  return bangkokYmd(new Date(Date.now() - days * 86_400_000));
}

/**
 * Stock Movement History: every change to every variant's stock, newest first. Sales, refunds, voids,
 * restocks and manual adjustments each leave a row with the exact time, quantity, reason and staff member.
 */
export default async function StockLedgerPage({ searchParams }: LedgerPageProps) {
  const locale = getServerLocale();
  const t = serverT(locale);

  const today = bangkokYmd();
  const from = isYmd(searchParams.from) ? searchParams.from : daysAgo(6);
  const to = isYmd(searchParams.to) && searchParams.to >= from ? searchParams.to : today > from ? today : from;
  const type = parseMovementType(searchParams.type);
  const reason = parseStockReason(searchParams.reason);
  const userId = searchParams.user || undefined;
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(searchParams.page ?? "1", 10) || 1));

  const where = buildLedgerWhere({ from, to, type, reason, userId, q });

  const [rows, total, byType, users, mismatch] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * LEDGER_PAGE_SIZE,
      take: LEDGER_PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        type: true,
        reasonCode: true,
        quantityChange: true,
        stockBefore: true,
        stockAfter: true,
        reference: true,
        note: true,
        variant: { select: { sku: true, size: true, color: true, product: { select: { id: true, name: true, nameTh: true } } } },
        user: { select: { fullName: true, username: true } },
      },
    }),
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.groupBy({ by: ["type"], where, _sum: { quantityChange: true }, _count: { _all: true } }),
    prisma.user.findMany({ select: { id: true, fullName: true, username: true }, orderBy: { fullName: "asc" } }),
    // Variants whose current stock differs from the last ledger entry: a sign that stock was changed outside the app.
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT count(*)::int AS count
      FROM "ProductVariant" v
      JOIN LATERAL (
        SELECT m."stockAfter" FROM "InventoryMovement" m
        WHERE m."variantId" = v.id
        ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
      ) last ON true
      WHERE last."stockAfter" <> v."stockQuantity"
    `),
  ]);

  const pages = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));
  const mismatched = mismatch[0]?.count ?? 0;
  const byTypeMap = new Map(byType.map((row) => [row.type, row]));

  const filterParams = new URLSearchParams({ from, to });
  if (type) filterParams.set("type", type);
  if (reason) filterParams.set("reason", reason);
  if (userId) filterParams.set("user", userId);
  if (q) filterParams.set("q", q);
  const pageHref = (target: number) => `/admin/inventory/ledger?${filterParams.toString()}&page=${target}`;
  const exportHref = (format: "csv" | "xlsx") => `/api/admin/export?kind=movements&format=${format}&${filterParams.toString()}`;
  const fieldClass = "h-9 rounded-md border bg-background px-3";

  const reasonText = (row: (typeof rows)[number]): string => {
    if (row.type === "ADJUSTMENT") {
      return [row.reasonCode ? t(`stockReason.${row.reasonCode}` as MessageKey) : null, row.note].filter(Boolean).join(" · ");
    }
    return row.note ?? "";
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("ledger.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("ledger.desc")}</p>
      </div>

      {mismatched > 0 ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{t("ledger.mismatchTitle", { count: mismatched })}</p>
          <p>{t("ledger.mismatchBody")}</p>
        </div>
      ) : null}

      <form className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.from")}</span>
          <input type="date" name="from" defaultValue={from} max={today} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.to")}</span>
          <input type="date" name="to" defaultValue={to} max={today} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.type")}</span>
          <select name="type" defaultValue={type ?? ""} className={fieldClass}>
            <option value="">{t("ledger.allTypes")}</option>
            {MOVEMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`ledger.type.${value}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.reason")}</span>
          <select name="reason" defaultValue={reason ?? ""} className={fieldClass}>
            <option value="">{t("ledger.allReasons")}</option>
            {STOCK_REASONS.map((value) => (
              <option key={value} value={value}>
                {t(`stockReason.${value}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("ledger.staff")}</span>
          <select name="user" defaultValue={userId ?? ""} className={fieldClass}>
            <option value="">{t("ledger.allStaff")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName} ({user.username})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm lg:col-span-2">
          <span className="text-muted-foreground">{t("ledger.search")}</span>
          <input name="q" defaultValue={q} placeholder={t("ledger.searchPlaceholder")} className={fieldClass} />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("ledger.apply")}
          </button>
          <Link href="/admin/inventory/ledger" className="flex h-9 items-center rounded-md border px-4 text-sm hover:bg-muted">
            {t("inventory.reset")}
          </Link>
        </div>
      </form>

      <section aria-label={t("ledger.summary")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MOVEMENT_TYPES.map((value) => {
          const row = byTypeMap.get(value);
          const units = row?._sum.quantityChange ?? 0;
          return (
            <div key={value} className="rounded-xl border bg-background p-3">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[value]}`}>{t(`ledger.type.${value}` as MessageKey)}</span>
              <p className="mt-2 text-lg font-semibold tabular-nums">
                {units > 0 ? "+" : ""}
                {units}
              </p>
              <p className="text-xs text-muted-foreground">{t("ledger.entries", { count: row?._count._all ?? 0 })}</p>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">{t("ledger.showing", { total, page, pages })}</p>
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
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("ledger.colTime")}</th>
              <th className="px-4 py-2 font-medium">{t("ledger.colType")}</th>
              <th className="px-4 py-2 font-medium">{t("ledger.colProduct")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("ledger.colChange")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("ledger.colBalance")}</th>
              <th className="px-4 py-2 font-medium">{t("ledger.colReason")}</th>
              <th className="px-4 py-2 font-medium">{t("ledger.colReference")}</th>
              <th className="px-4 py-2 font-medium">{t("ledger.colStaff")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {t("ledger.none")}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">{bangkokStamp(row.createdAt)}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[row.type]}`}>{t(`ledger.type.${row.type}` as MessageKey)}</span>
                </td>
                <td className="px-4 py-2">
                  <Link href={`/admin/products/${row.variant.product.id}`} className="font-medium hover:underline">
                    {localizedName(locale, row.variant.product.name, row.variant.product.nameTh)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {row.variant.size} / {row.variant.color} · <span className="font-mono">{row.variant.sku}</span>
                  </p>
                </td>
                <td className={`px-4 py-2 text-right font-semibold tabular-nums ${row.quantityChange < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {row.quantityChange > 0 ? "+" : ""}
                  {row.quantityChange}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {row.stockBefore} → <span className="font-medium text-foreground">{row.stockAfter}</span>
                </td>
                <td className="max-w-[260px] px-4 py-2">{reasonText(row) || "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{row.reference ?? "—"}</td>
                <td className="px-4 py-2">
                  {row.user ? (
                    <>
                      <p>{row.user.fullName}</p>
                      <p className="text-xs text-muted-foreground">{row.user.username}</p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
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
