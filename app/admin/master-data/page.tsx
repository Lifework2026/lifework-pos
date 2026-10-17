import Link from "next/link";
import { ActionBar } from "@/components/admin/action-bar";
import { ClearDemoPanel } from "@/components/admin/clear-demo-panel";
import { prisma } from "@/lib/prisma";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { isLegacyCategoryCode, isLegacyColorCode, planDemoClear } from "@/lib/master-demo";

export const dynamic = "force-dynamic";

/** The Attribute and Catalog ID database: every category and colour with its code, which Excel uploads reference. */
export default async function MasterDataPage() {
  const t = serverT(getServerLocale());

  const [categories, colors] = await Promise.all([
    prisma.category.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        nameTh: true,
        _count: { select: { products: true, promotions: true } },
      },
    }),
    prisma.color.findMany({
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true, nameTh: true, sortOrder: true, _count: { select: { variants: true } } },
    }),
  ]);

  const categoryUses = categories.map((c) => ({ id: c.code, code: c.code, uses: c._count.products + c._count.promotions }));
  const colorUses = colors.map((c) => ({ id: c.code, code: c.code, uses: c._count.variants }));
  const categoryPlan = planDemoClear(categoryUses, isLegacyCategoryCode);
  const colorPlan = planDemoClear(colorUses, isLegacyColorCode);
  const ready = categories.length > 0 && colors.length > 0;

  const panel = "rounded-xl border bg-card";
  const head = "bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("master.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("master.desc")}</p>
        </div>
      </div>

      <section className={`${panel} p-5`} aria-labelledby="master-guide">
        <h2 id="master-guide" className="text-base font-semibold">
          {t("master.guideTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("master.guideBody")}</p>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          <li className={`rounded-lg border p-4 ${ready ? "border-emerald-400/60" : "border-amber-400/60"}`}>
            <p className="font-semibold">{t("master.step1")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {ready
                ? t("master.step1Done", { categories: categories.length, colors: colors.length })
                : t("master.step1Todo")}
            </p>
          </li>
          <li className="rounded-lg border p-4">
            <p className="font-semibold">{t("master.step2")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("master.step2Body")}</p>
            <Link href="/admin/products" className="mt-2 inline-block text-sm underline">
              {t("nav.products")}
            </Link>
          </li>
          <li className="rounded-lg border p-4">
            <p className="font-semibold">{t("master.step3")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("master.step3Body")}</p>
            <Link href="/admin/inventory/receive" className="mt-2 inline-block text-sm underline">
              {t("nav.receive")}
            </Link>
          </li>
        </ol>
      </section>

      <section className={panel} aria-labelledby="master-categories">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
          <div>
            <h2 id="master-categories" className="text-base font-semibold">
              {t("master.catsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("master.catsHint")}</p>
          </div>
          <ActionBar createHref="/admin/catalog" template="D" exportKind="categories" />
        </header>
        {categories.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t("master.emptyCats")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className={head}>
                <tr>
                  <th className="px-5 py-2 font-medium">{t("master.colCatalogId")}</th>
                  <th className="px-3 py-2 font-medium">{t("master.colNameEn")}</th>
                  <th className="px-3 py-2 font-medium">{t("master.colNameTh")}</th>
                  <th className="px-3 py-2 font-medium">{t("master.colUsage")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("master.colEdit")}</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => {
                  const uses = row._count.products + row._count.promotions;
                  return (
                    <tr key={row.code} className="border-t">
                      <td className="px-5 py-3">
                        <span className="inline-flex min-w-12 items-center justify-center rounded-md border-2 border-primary/40 bg-primary/10 px-3 py-1 font-mono text-lg font-bold tracking-wider">
                          {row.code}
                        </span>
                        {isLegacyCategoryCode(row.code) ? (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            {t("master.demoBadge")}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-medium">{row.name}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.nameTh ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span className={uses > 0 ? "font-medium" : "text-muted-foreground"}>
                          {uses > 0 ? t("master.inUse", { count: uses }) : t("master.notUsed")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link href="/admin/catalog" className="text-sm underline">
                          {t("master.colEdit")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={panel} aria-labelledby="master-colors">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
          <div>
            <h2 id="master-colors" className="text-base font-semibold">
              {t("master.colorsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("master.colorsHint")}</p>
          </div>
          <ActionBar createHref="/admin/colors" template="E" exportKind="colors" />
        </header>
        {colors.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t("master.emptyColors")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className={head}>
                <tr>
                  <th className="px-5 py-2 font-medium">{t("master.colCatalogId")}</th>
                  <th className="px-3 py-2 font-medium">{t("master.colNameEn")}</th>
                  <th className="px-3 py-2 font-medium">{t("master.colNameTh")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("master.colOrder")}</th>
                  <th className="px-3 py-2 font-medium">{t("master.colUsage")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("master.colEdit")}</th>
                </tr>
              </thead>
              <tbody>
                {colors.map((row) => (
                  <tr key={row.code} className="border-t">
                    <td className="px-5 py-3">
                      <span className="inline-flex min-w-12 items-center justify-center rounded-md border-2 border-primary/40 bg-primary/10 px-3 py-1 font-mono text-lg font-bold tracking-wider">
                        {row.code}
                      </span>
                      {isLegacyColorCode(row.code) ? (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          {t("master.demoBadge")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-medium">{row.name}</td>
                    <td className="px-3 py-3 text-muted-foreground">{row.nameTh ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.sortOrder}</td>
                    <td className="px-3 py-3">
                      <span className={row._count.variants > 0 ? "font-medium" : "text-muted-foreground"}>
                        {row._count.variants > 0 ? t("master.variants", { count: row._count.variants }) : t("master.notUsed")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link href="/admin/colors" className="text-sm underline">
                        {t("master.colEdit")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ClearDemoPanel
        removable={[
          ...categoryPlan.remove.map((row) => ({ kind: "category" as const, code: row.code })),
          ...colorPlan.remove.map((row) => ({ kind: "color" as const, code: row.code })),
        ]}
        kept={[
          ...categoryPlan.keep.map((row) => ({ kind: "category" as const, code: row.code, uses: row.uses })),
          ...colorPlan.keep.map((row) => ({ kind: "color" as const, code: row.code, uses: row.uses })),
        ]}
      />
    </div>
  );
}
