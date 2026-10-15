import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ActionBar } from "@/components/admin/action-bar";
import { ProductThumb } from "@/components/pos/product-thumb";
import { prisma } from "@/lib/prisma";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { localizedName } from "@/lib/payment-labels";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 300;
const SHOWN_VARIANTS = 3;

interface ProductsPageProps {
  searchParams: { q?: string; category?: string; status?: string };
}

/** Product catalogue: photo, category code, SKU and barcode, stock and price range at a glance. */
export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const locale = getServerLocale();
  const t = serverT(locale);
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const categoryId = searchParams.category ?? "";
  const status = searchParams.status === "active" || searchParams.status === "inactive" ? searchParams.status : "";

  const where: Prisma.ProductWhereInput = {
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { isActive: status === "active" } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { nameTh: { contains: q, mode: "insensitive" } },
            { brand: { contains: q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
            { variants: { some: { barcode: q } } },
          ],
        }
      : {}),
  };

  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take: ROW_LIMIT,
      select: {
        id: true,
        name: true,
        nameTh: true,
        brand: true,
        imageUrl: true,
        isActive: true,
        category: { select: { code: true, name: true, nameTh: true } },
        variants: {
          orderBy: [{ size: "asc" }],
          select: {
            sku: true,
            barcode: true,
            size: true,
            price: true,
            stockQuantity: true,
            isActive: true,
            colorRef: { select: { code: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } }),
  ]);

  const field = "h-9 rounded-md border bg-background px-3 text-sm";
  const linkButton = "inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("products.listTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("products.listSummary", { count: total })}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ActionBar createHref="/admin/products/new" template="A" exportKind="inventory" />
          <Link href="/admin/catalog" className="text-sm text-muted-foreground underline">
            {t("products.catalog")}
          </Link>
        </div>
      </div>

      <form className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-[1fr_200px_160px_auto] md:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("pos.searchLabel")}</span>
          <input name="q" defaultValue={q} placeholder={t("products.searchPlaceholder")} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("products.category")}</span>
          <select name="category" defaultValue={categoryId} className={field}>
            <option value="">{t("products.allCategories")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {localizedName(locale, category.name, category.nameTh)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("sales.status")}</span>
          <select name="status" defaultValue={status} className={field}>
            <option value="">{t("products.statusAll")}</option>
            <option value="active">{t("products.statusActive")}</option>
            <option value="inactive">{t("products.statusInactive")}</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("sales.apply")}
          </button>
          <Link href="/admin/products" className={linkButton}>
            {t("inventory.reset")}
          </Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("products.colProduct")}</th>
              <th className="px-4 py-2 font-medium">{t("products.category")}</th>
              <th className="px-4 py-2 font-medium">{t("products.colSkuCodes")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("products.colVariantCount")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("products.colStock")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("products.colPriceRange")}</th>
              <th className="px-4 py-2 font-medium">{t("sales.colStatus")}</th>
              <th className="px-4 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {t("products.noMatch")}
                </td>
              </tr>
            ) : null}
            {products.map((product) => {
              const prices = product.variants.map((variant) => Number(variant.price));
              const min = prices.length ? Math.min(...prices) : 0;
              const max = prices.length ? Math.max(...prices) : 0;
              const stock = product.variants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
              const hidden = product.variants.length - SHOWN_VARIANTS;
              return (
                <tr key={product.id} className={`border-t align-top ${product.isActive ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <ProductThumb src={product.imageUrl} alt={product.name} className="size-12 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{localizedName(locale, product.name, product.nameTh)}</p>
                        <p className="truncate text-xs text-muted-foreground">{product.brand ?? "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <p>{localizedName(locale, product.category.name, product.category.nameTh)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{product.category.code}</p>
                  </td>
                  <td className="px-4 py-2">
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {product.variants.slice(0, SHOWN_VARIANTS).map((variant, index) => (
                        <li key={`${variant.sku}-${index}`} className="flex flex-wrap gap-x-2">
                          <span className="font-mono">{variant.sku}</span>
                          <span className="font-mono text-muted-foreground">{variant.barcode}</span>
                          <span className="text-muted-foreground">
                            {variant.colorRef?.code ?? "—"} · {variant.size}
                          </span>
                        </li>
                      ))}
                      {hidden > 0 ? <li className="text-muted-foreground">{t("products.moreVariants", { count: hidden })}</li> : null}
                    </ul>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{product.variants.length}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{stock}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {min === max ? formatBaht(min) : `${formatBaht(min)} – ${formatBaht(max)}`}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${product.isActive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
                    >
                      {product.isActive ? t("products.statusActive") : t("products.statusInactive")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/products/${product.id}`} className={linkButton}>
                      {t("products.edit")}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > ROW_LIMIT ? <p className="text-sm text-muted-foreground">{t("products.limitNote", { limit: ROW_LIMIT })}</p> : null}
    </div>
  );
}
