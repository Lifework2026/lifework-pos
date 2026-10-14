import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { bangkokDayRange, bangkokYmd, isYmd } from "@/lib/bangkok";
import { formatBaht } from "@/lib/format";
import { paymentLabel } from "@/lib/payment-labels";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const LOW_STOCK_THRESHOLD = 3;

interface DashboardProps {
  searchParams: { date?: string };
}

/** Daily sales summary: revenue, sales count and payment mix for one store day (Bangkok time). */
export default async function AdminDashboardPage({ searchParams }: DashboardProps) {
  const date = isYmd(searchParams.date) ? searchParams.date : bangkokYmd();
  const { start, end } = bangkokDayRange(date);

  const [byMethod, lowStockCount, outOfStockCount] = await Promise.all([
    prisma.order.groupBy({
      by: ["paymentMethod"],
      where: { status: "COMPLETED", createdAt: { gte: start, lt: end } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.productVariant.count({
      where: { isActive: true, stockQuantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
    }),
    prisma.productVariant.count({ where: { isActive: true, stockQuantity: { lte: 0 } } }),
  ]);

  const revenue = byMethod.reduce((sum, row) => sum.plus(row._sum.totalAmount ?? 0), new Prisma.Decimal(0));
  const salesCount = byMethod.reduce((sum, row) => sum + row._count._all, 0);
  const averageTicket = salesCount > 0 ? revenue.div(salesCount) : new Prisma.Decimal(0);
  const breakdown = [...byMethod].sort((a, b) =>
    new Prisma.Decimal(b._sum.totalAmount ?? 0).comparedTo(a._sum.totalAmount ?? 0),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily sales</h1>
          <p className="text-sm text-muted-foreground">Store day {date} (Bangkok time)</p>
        </div>
        <form className="flex items-end gap-2" action="/admin">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Day</span>
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
          <button type="submit" className="h-9 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">
            Show
          </button>
        </form>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total revenue" value={formatBaht(Number(revenue.toFixed(2)))} />
        <StatCard label="Sales" value={String(salesCount)} />
        <StatCard label="Average sale" value={formatBaht(Number(averageTicket.toFixed(2)))} />
        <StatCard
          label="Stock alerts"
          value={`${lowStockCount} low · ${outOfStockCount} out`}
          tone={lowStockCount + outOfStockCount > 0 ? "warning" : "default"}
          href="/admin/inventory?stock=low"
        />
      </section>

      <section className="rounded-xl border bg-background">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Payment methods</h2>
        </div>
        {breakdown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No completed sales on this day.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-4 py-2 text-right font-medium">Sales</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => {
                const amount = row._sum.totalAmount ?? new Prisma.Decimal(0);
                const share = revenue.gt(0) ? amount.div(revenue).mul(100).toDecimalPlaces(1).toNumber() : 0;
                return (
                  <tr key={row.paymentMethod} className="border-t">
                    <td className="px-4 py-2 font-medium">{paymentLabel(row.paymentMethod)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row._count._all}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBaht(Number(amount.toFixed(2)))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        View individual sales in <Link href={`/admin/orders?from=${date}&to=${date}`} className="underline">Sales</Link>.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
  href?: string;
}) {
  const body = (
    <div
      className={`rounded-xl border p-4 ${
        tone === "warning" ? "border-amber-300 bg-amber-50" : "bg-background"
      }`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
