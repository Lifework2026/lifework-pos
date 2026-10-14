import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bangkokDayRange, bangkokYmd, isYmd } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { orderSelect, serializeOrder } from "@/lib/orders/serialize";
import { PAYMENT_METHOD_LABELS, paymentLabel } from "@/lib/payment-labels";
import { OrdersTable } from "@/components/admin/orders-table";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 300;
const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS);
const STATUSES = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED", "VOIDED"] as const;

interface OrdersPageProps {
  searchParams: { from?: string; to?: string; receipt?: string; method?: string; cashier?: string; status?: string };
}

/** Sales log with filters. Defaults to today (Bangkok time) when no dates are given. */
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const locale = getServerLocale();
  const t = serverT(locale);
  const today = bangkokYmd();
  const requestedFrom = isYmd(searchParams.from) ? searchParams.from : undefined;
  const requestedTo = isYmd(searchParams.to) ? searchParams.to : undefined;
  const fromYmd = requestedFrom ?? requestedTo ?? today;
  const toYmd = requestedTo ?? requestedFrom ?? today;
  const [rangeStart, rangeEnd] = fromYmd <= toYmd ? [fromYmd, toYmd] : [toYmd, fromYmd];

  const receipt = (searchParams.receipt ?? "").trim().slice(0, 40);
  const method = PAYMENT_METHODS.includes(searchParams.method ?? "") ? (searchParams.method as string) : "";
  const cashierId = searchParams.cashier ?? "";
  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? "") ? (searchParams.status as string) : "";

  const where: Prisma.OrderWhereInput = {
    createdAt: { gte: bangkokDayRange(rangeStart).start, lt: bangkokDayRange(rangeEnd).end },
    ...(receipt ? { receiptNo: { contains: receipt, mode: "insensitive" } } : {}),
    ...(method ? { payments: { some: { method: method as never } } } : {}),
    ...(cashierId ? { cashierId } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [orders, totals, cashiers] = await Promise.all([
    prisma.order.findMany({ where, select: orderSelect, orderBy: { createdAt: "desc" }, take: ROW_LIMIT }),
    prisma.order.aggregate({
      where: { ...where, status: { not: "VOIDED" } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);

  const shownTotal = Number((totals._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2));
  const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} - ${rangeEnd}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("sales.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("sales.summary", { range: rangeLabel, count: totals._count._all, amount: formatBaht(shownTotal) })}
        </p>
      </div>

      <form className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-3 md:items-end xl:grid-cols-7">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.from")}</span>
          <input type="date" name="from" defaultValue={rangeStart} className="h-9 rounded-md border bg-background px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.to")}</span>
          <input type="date" name="to" defaultValue={rangeEnd} className="h-9 rounded-md border bg-background px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.receiptNo")}</span>
          <input name="receipt" defaultValue={receipt} placeholder="POS-…" className="h-9 rounded-md border bg-background px-3 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.channel")}</span>
          <select name="method" defaultValue={method} className="h-9 rounded-md border bg-background px-3">
            <option value="">{t("sales.allChannels")}</option>
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {paymentLabel(value, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.staff")}</span>
          <select name="cashier" defaultValue={cashierId} className="h-9 rounded-md border bg-background px-3">
            <option value="">{t("sales.allStaff")}</option>
            {cashiers.map((cashier) => (
              <option key={cashier.id} value={cashier.id}>
                {cashier.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.status")}</span>
          <select name="status" defaultValue={status} className="h-9 rounded-md border bg-background px-3">
            <option value="">{t("sales.allStatuses")}</option>
            <option value="COMPLETED">{t("sales.statusCompleted")}</option>
            <option value="PARTIALLY_REFUNDED">{t("sales.statusPartial")}</option>
            <option value="REFUNDED">{t("sales.statusRefunded")}</option>
            <option value="VOIDED">{t("sales.statusVoided")}</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("sales.apply")}
          </button>
          <Link href="/admin/orders" className="flex h-9 items-center rounded-md border px-4 text-sm hover:bg-muted">
            {t("sales.today")}
          </Link>
        </div>
      </form>

      <OrdersTable orders={orders.map(serializeOrder)} />

      {totals._count._all > ROW_LIMIT ? (
        <p className="text-sm text-muted-foreground">{t("sales.showingLatest", { limit: ROW_LIMIT })}</p>
      ) : null}
    </div>
  );
}
