import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ActionBar } from "@/components/admin/action-bar";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { localizedName } from "@/lib/payment-labels";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const LOW_STOCK_THRESHOLD = 3;
const ROW_LIMIT = 500;
const STOCK_FILTERS = ["all", "low", "out", "ok"] as const;
type StockFilter = (typeof STOCK_FILTERS)[number];

interface InventoryPageProps {
  searchParams: { q?: string; category?: string; stock?: string };
}

function parseStockFilter(value: string | undefined): StockFilter {
  return (STOCK_FILTERS as readonly string[]).includes(value ?? "") ? (value as StockFilter) : "all";
}

function stockWhere(filter: StockFilter): Prisma.ProductVariantWhereInput {
  switch (filter) {
    case "low":
      return { stockQuantity: { lte: LOW_STOCK_THRESHOLD } };
    case "out":
      return { stockQuantity: { lte: 0 } };
    case "ok":
      return { stockQuantity: { gt: LOW_STOCK_THRESHOLD } };
    default:
      return {};
  }
}

/** Stock overview: every variant with its exact quantity, SKU, barcode and catalog codes. Low variants are flagged. */
export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const locale = getServerLocale();
  const t = serverT(locale);
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const categoryId = searchParams.category ?? "";
  const stock = parseStockFilter(searchParams.stock);

  const where: Prisma.ProductVariantWhereInput = {
    ...stockWhere(stock),
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { barcode: q },
            { product: { name: { contains: q, mode: "insensitive" } } },
            { product: { brand: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(categoryId ? { product: { categoryId } } : {}),
  };

  const [variants, matchCount, categories, totals] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      select: {
        id: true,
        size: true,
        color: true,
        sku: true,
        barcode: true,
        price: true,
        stockQuantity: true,
        isActive: true,
        colorRef: { select: { code: true } },
        product: {
          select: {
            id: true,
            name: true,
            nameTh: true,
            brand: true,
            category: { select: { code: true, name: true, nameTh: true } },
          },
        },
      },
      orderBy: [{ product: { name: "asc" } }, { color: "asc" }, { size: "asc" }],
      take: ROW_LIMIT,
    }),
    prisma.productVariant.count({ where }),
    prisma.category.findMany({ select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } }),
    prisma.productVariant.aggregate({
      where: { isActive: true },
      _count: { _all: true },
      _sum: { stockQuantity: true },
    }),
  ]);

  const lowCount = await prisma.productVariant.count({
    where: { isActive: true, stockQuantity: { lte: LOW_STOCK_THRESHOLD } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("inventory.title")}</h1>
          <p className="text-sm text-muted-foreground">
            <span className={lowCount > 0 ? "font-medium text-amber-700" : ""}>
              {t("inventory.summary", {
                variants: totals._count._all,
                units: totals._sum.stockQuantity ?? 0,
                low: lowCount,
                threshold: LOW_STOCK_THRESHOLD,
              })}
            </span>
          </p>
        </div>
        <ActionBar createHref="/admin/products/new" template="C" exportKind="inventory" />
      </div>

      <form className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-[1fr_200px_180px_auto] md:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("inventory.search")}</span>
          <input
            name="q"
            defaultValue={q}
            placeholder={t("inventory.searchPlaceholder")}
            className="h-9 rounded-md border bg-background px-3"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("inventory.category")}</span>
          <select name="category" defaultValue={categoryId} className="h-9 rounded-md border bg-background px-3">
            <option value="">{t("inventory.allCategories")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {localizedName(locale, category.name, category.nameTh)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("inventory.stock")}</span>
          <select name="stock" defaultValue={stock} className="h-9 rounded-md border bg-background px-3">
            <option value="all">{t("inventory.filterAll")}</option>
            <option value="low">{t("inventory.filterLow")}</option>
            <option value="out">{t("inventory.filterOut")}</option>
            <option value="ok">{t("inventory.filterOk")}</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("inventory.apply")}
          </button>
          <Link href="/admin/inventory" className="flex h-9 items-center rounded-md border px-4 text-sm hover:bg-muted">
            {t("inventory.reset")}
          </Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("inventory.colProduct")}</th>
              <th className="px-4 py-2 font-medium">{t("inventory.colCategory")}</th>
              <th className="px-4 py-2 font-medium">{t("inventory.colSize")}</th>
              <th className="px-4 py-2 font-medium">{t("inventory.colColor")}</th>
              <th className="px-4 py-2 font-medium">{t("inventory.colSku")}</th>
              <th className="px-4 py-2 font-medium">{t("inventory.colBarcode")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("inventory.colPrice")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("inventory.stock")}</th>
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {t("inventory.none")}
                </td>
              </tr>
            ) : null}
            {variants.map((variant) => {
              const out = variant.stockQuantity <= 0;
              const low = !out && variant.stockQuantity <= LOW_STOCK_THRESHOLD;
              const rowTone = out ? "bg-red-50" : low ? "bg-amber-50" : "";
              return (
                <tr key={variant.id} className={`border-t ${rowTone} ${variant.isActive ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/products/${variant.product.id}`} className="font-medium hover:underline">
                      {localizedName(locale, variant.product.name, variant.product.nameTh)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {variant.product.brand ?? "—"}
                      {variant.isActive ? "" : ` · ${t("inventory.inactive")}`}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    {localizedName(locale, variant.product.category.name, variant.product.category.nameTh)}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{variant.product.category.code}</span>
                  </td>
                  <td className="px-4 py-2">{variant.size}</td>
                  <td className="px-4 py-2">
                    {variant.color}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{variant.colorRef?.code}</span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{variant.sku}</td>
                  <td className="px-4 py-2 font-mono text-xs">{variant.barcode}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatBaht(Number(variant.price.toFixed(2)))}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      {out ? (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">{t("inventory.badgeOut")}</span>
                      ) : null}
                      {low ? (
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">{t("inventory.badgeLow")}</span>
                      ) : null}
                      <span
                        className={`font-semibold tabular-nums ${out ? "text-red-700" : low ? "text-amber-700" : ""}`}
                      >
                        {variant.stockQuantity}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("inventory.showing", { shown: Math.min(variants.length, ROW_LIMIT), total: matchCount })}
        {matchCount > ROW_LIMIT ? ` ${t("inventory.refine")}` : ""}
      </p>
    </div>
  );
}
