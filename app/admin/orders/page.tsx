import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bangkokDayRange, bangkokYmd, isYmd } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { orderSelect, serializeOrder } from "@/lib/orders/serialize";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-labels";
import { OrdersTable } from "@/components/admin/orders-table";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 300;
const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS);

interface OrdersPageProps {
  searchParams: { from?: string; to?: string; receipt?: string; method?: string; cashier?: string };
}

/** Sales log with filters. Defaults to today (Bangkok time) when no dates are given. */
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const today = bangkokYmd();
  const requestedFrom = isYmd(searchParams.from) ? searchParams.from : undefined;
  const requestedTo = isYmd(searchParams.to) ? searchParams.to : undefined;
  const fromYmd = requestedFrom ?? requestedTo ?? today;
  const toYmd = requestedTo ?? requestedFrom ?? today;
  const [rangeStartYmd, rangeEndYmd] = fromYmd <= toYmd ? [fromYmd, toYmd] : [toYmd, fromYmd];

  const receipt = (searchParams.receipt ?? "").trim().slice(0, 40);
  const method = PAYMENT_METHODS.includes(searchParams.method ?? "") ? searchParams.method! : "";
  const cashierId = searchParams.cashier ?? "";

  const where: Prisma.OrderWhereInput = {
    status: "COMPLETED",
    createdAt: {
      gte: bangkokDayRange(rangeStartYmd).start,
      lt: bangkokDayRange(rangeEndYmd).end,
    },
    ...(receipt ? { receiptNo: { contains: receipt, mode: "insensitive" } } : {}),
    ...(method ? { paymentMethod: method as Prisma.EnumPaymentMethodFilter["equals"] } : {}),
    ...(cashierId ? { cashierId } : {}),
  };

  const [orders, totals, cashiers] = await Promise.all([
    prisma.order.findMany({ where, select: orderSelect, orderBy: { createdAt: "desc" }, take: ROW_LIMIT }),
    prisma.order.aggregate({ where, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);

  const totalAmount = Number((totals._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sales history</h1>
        <p className="text-sm text-muted-foreground">
          {rangeStartYmd === rangeEndYmd ? `Day ${rangeStartYmd}` : `${rangeStartYmd} to ${rangeEndYmd}`} (Bangkok time)
          {" · "}
          {totals._count._all} sales · {formatBaht(totalAmount)}
        </p>
      </div>

      <form className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-3 xl:grid-cols-6 md:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={rangeStartYmd} className="h-9 rounded-md border bg-background px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={rangeEndYmd} className="h-9 rounded-md border bg-background px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Receipt no.</span>
          <input name="receipt" defaultValue={receipt} placeholder="POS-…" className="h-9 rounded-md border bg-background px-3 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Payment</span>
          <select name="method" defaultValue={method} className="h-9 rounded-md border bg-background px-3">
            <option value="">All methods</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Cashier</span>
          <select name="cashier" defaultValue={cashierId} className="h-9 rounded-md border bg-background px-3">
            <option value="">All cashiers</option>
            {cashiers.map((cashier) => (
              <option key={cashier.id} value={cashier.id}>
                {cashier.fullName}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            Apply
          </button>
          <Link href="/admin/orders" className="flex h-9 items-center rounded-md border px-4 text-sm hover:bg-muted">
            Today
          </Link>
        </div>
      </form>

      <OrdersTable orders={orders.map(serializeOrder)} />

      {totals._count._all > ROW_LIMIT ? (
        <p className="text-sm text-muted-foreground">
          Showing the latest {ROW_LIMIT} of {totals._count._all} sales. Narrow the dates to see more.
        </p>
      ) : null}
    </div>
  );
}
