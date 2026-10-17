import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ActionBar } from "@/components/admin/action-bar";
import { ProductFilters } from "@/components/admin/product-filters";
import { ProductThumb } from "@/components/pos/product-thumb";
import { parseProductFilter, productWhere, type ProductFilterParams } from "@/lib/catalog/product-filter";
import { photoCoverage, variantImageUrl } from "@/lib/catalog/variant-image";
import { prisma } from "@/lib/prisma";
import { formatBaht } from "@/lib/format";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { localizedName } from "@/lib/payment-labels";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 500;
const SHOWN_VARIANTS = 3;

interface ProductsPageProps {
  searchParams: ProductFilterParams;
}

/** Product catalogue: photo, category code, SKU and barcode, stock and price range at a glance. */
export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const locale = getServerLocale();
  const t = serverT(locale);
  const filter = parseProductFilter(searchParams);
  let where: Prisma.ProductWhereInput = productWhere(filter);
  // "No photo yet" means a colour that shows no photo: it has none of its own and the product has none either.
  // That cannot be written as one query, so the products that match the other filters are checked here.
  if (filter.image === "missing") {
    const candidates = await prisma.product.findMany({
      where,
      select: { id: true, imageUrl: true, variants: { select: { colorId: true } }, colorImages: { select: { colorId: true } } },
    });
    where = { ...where, id: { in: candidates.filter((candidate) => photoCoverage(candidate).missing > 0).map((candidate) => candidate.id) } };
  }

  const [products, total, categories, colors] = await Promise.all([
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
        colorImages: { select: { colorId: true, imageUrl: true } },
        isActive: true,
        category: { select: { code: true, name: true, nameTh: true } },
        variants: {
          orderBy: [{ size: "asc" }],
          select: {
            colorId: true,
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
    prisma.category.findMany({ select: { code: true, name: true, nameTh: true }, orderBy: { code: "asc" } }),
    prisma.color.findMany({ select: { code: true, name: true, nameTh: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
  ]);

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

      {categories.length === 0 || colors.length === 0 ? (
        <Link href="/admin/master-data" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t("products.setupNeeded")}
          <span className="underline">{t("nav.masterData")}</span>
        </Link>
      ) : null}
      <ProductFilters
        q={filter.q}
        category={filter.category}
        color={filter.color}
        status={filter.status}
        image={filter.image}
        categories={categories}
        colors={colors}
      />

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
              // With a colour chosen, the row shows that colour: its photo, its sizes, its stock and price.
              const variants = filter.color ? product.variants.filter((variant) => variant.colorRef?.code === filter.color) : product.variants;
              const photo = filter.color && variants[0] ? variantImageUrl(product, variants[0].colorId) : (product.imageUrl ?? product.colorImages[0]?.imageUrl ?? null);
              const coverage = photoCoverage(product);
              const prices = variants.map((variant) => Number(variant.price));
              const min = prices.length ? Math.min(...prices) : 0;
              const max = prices.length ? Math.max(...prices) : 0;
              const stock = variants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
              const hidden = variants.length - SHOWN_VARIANTS;
              return (
                <tr key={product.id} className={`border-t align-top ${product.isActive ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <ProductThumb src={photo} alt={product.name} className="size-12 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{localizedName(locale, product.name, product.nameTh)}</p>
                        <p className="truncate text-xs text-muted-foreground">{product.brand ?? "—"}</p>
                        <p
                          className={`text-xs ${coverage.missing === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                        >
                          {t("products.photoCoverage", { done: coverage.withPhoto, total: coverage.colors })}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <p>{localizedName(locale, product.category.name, product.category.nameTh)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{product.category.code}</p>
                  </td>
                  <td className="px-4 py-2">
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {variants.slice(0, SHOWN_VARIANTS).map((variant, index) => (
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
                  <td className="px-4 py-2 text-right tabular-nums">{variants.length}</td>
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
