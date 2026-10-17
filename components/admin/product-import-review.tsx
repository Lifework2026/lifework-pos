"use client";

import { useState } from "react";
import { ProductCard } from "@/components/pos/product-card";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { ProductPreview, ProductPreviewRow } from "@/lib/catalog/preview-types";

interface ProductImportReviewProps {
  preview: ProductPreview;
}

/** Rows that belong to one product: same name and category, as the template instructions say. */
function productKey(row: ProductPreviewRow): string {
  return `${row.nameTh ?? row.name}|${row.categoryCode}`;
}

function StatusChip({ status }: { status: ProductPreviewRow["status"] }) {
  const { t } = useI18n();
  return status === "new" ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      {t("import.statusNew")}
    </span>
  ) : (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {t("import.statusSkipped")}
    </span>
  );
}

/**
 * The three-panel review: the parsed Excel table, a row-by-row text view, and the till's own product card for the
 * selected row. Nothing here writes; it only shows what the import will do.
 */
export function ProductImportReview({ preview }: ProductImportReviewProps) {
  const { t, locale } = useI18n();
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const rows = preview.rows;
  const selected = rows.find((row) => row.line === selectedLine) ?? rows[0];
  if (!selected) return null;

  const group = rows.filter((row) => productKey(row) === productKey(selected));
  const sizes = Array.from(new Set(group.map((row) => row.size))).map((label) => ({ label, active: label === selected.size }));

  const panel = "flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-3";
  const heading = "text-sm font-semibold";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{t("import.columnsInFile")}:</span> {preview.headers.join(", ") || "—"}
        </span>
        {preview.missingColumns.length > 0 ? (
          <span className="text-amber-700 dark:text-amber-400">{t("import.columnsMissing", { list: preview.missingColumns.join(", ") })}</span>
        ) : null}
        {preview.rowCount > rows.length ? (
          <span>{t("import.showingRows", { shown: rows.length, total: preview.rowCount })}</span>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <section className={panel} aria-label={t("import.parsedTitle")}>
          <h3 className={heading}>{t("import.parsedTitle")}</h3>
          <div className="max-h-[56vh] overflow-auto rounded-md border">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">{t("import.lineHeader")}</th>
                  <th className="px-2 py-1.5 font-medium">Barcode</th>
                  <th className="px-2 py-1.5 font-medium">SKU</th>
                  <th className="px-2 py-1.5 font-medium">Name_TH</th>
                  <th className="px-2 py-1.5 font-medium">Category_Code</th>
                  <th className="px-2 py-1.5 font-medium">Color_Code</th>
                  <th className="px-2 py-1.5 font-medium">Size</th>
                  <th className="px-2 py-1.5 text-right font-medium">Price</th>
                  <th className="px-2 py-1.5 text-right font-medium">Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium">Initial_Stock</th>
                  <th className="px-2 py-1.5 font-medium">Promo_Tag</th>
                  <th className="px-2 py-1.5 font-medium">{t("import.statusHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const active = row.line === selected.line;
                  return (
                    <tr
                      key={row.line}
                      onClick={() => setSelectedLine(row.line)}
                      className={`cursor-pointer border-t ${active ? "bg-primary/10" : "hover:bg-muted/50"}`}
                    >
                      <td className="px-2 py-1 tabular-nums text-muted-foreground">{row.line}</td>
                      <td className="px-2 py-1 font-mono">{row.barcode ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">{row.sku}</td>
                      <td className="px-2 py-1">{row.nameTh ?? row.name}</td>
                      <td className="px-2 py-1 font-mono">{row.categoryCode}</td>
                      <td className="px-2 py-1 font-mono">{row.colorCode}</td>
                      <td className="px-2 py-1">{row.size}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatBaht(row.priceSatang / 100)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.costSatang === null ? "—" : formatBaht(row.costSatang / 100)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.stock ?? "—"}</td>
                      <td className="px-2 py-1">{row.promoTag ?? "—"}</td>
                      <td className="px-2 py-1">
                        <StatusChip status={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={panel} aria-label={t("import.rowsTitle")}>
          <h3 className={heading}>{t("import.rowsTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("import.clickRow")}</p>
          <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((row) => {
              const active = row.line === selected.line;
              return (
                <button
                  key={row.line}
                  type="button"
                  onClick={() => setSelectedLine(row.line)}
                  aria-pressed={active}
                  className={`w-full rounded-md border p-2.5 text-left text-xs ${active ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                >
                  <p className="mb-1.5 flex items-center justify-between font-semibold">
                    <span>{t("xls.line", { line: row.line })}</span>
                    <StatusChip status={row.status} />
                  </p>
                  <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-0.5 font-mono">
                    <dt className="text-muted-foreground">Barcode</dt>
                    <dd>{row.barcode ?? "—"}</dd>
                    <dt className="text-muted-foreground">SKU</dt>
                    <dd>{row.sku}</dd>
                    <dt className="text-muted-foreground">Name_TH</dt>
                    <dd className="font-sans">{row.nameTh ?? row.name}</dd>
                    <dt className="text-muted-foreground">Category Code</dt>
                    <dd>{row.categoryCode}</dd>
                    <dt className="text-muted-foreground">Color Code</dt>
                    <dd>{row.colorCode}</dd>
                    <dt className="text-muted-foreground">Size</dt>
                    <dd>{row.size}</dd>
                    <dt className="text-muted-foreground">Price</dt>
                    <dd>{formatBaht(row.priceSatang / 100)}</dd>
                    <dt className="text-muted-foreground">Cost</dt>
                    <dd>{row.costSatang === null ? "—" : formatBaht(row.costSatang / 100)}</dd>
                    <dt className="text-muted-foreground">Initial Stock</dt>
                    <dd>{row.stock ?? "—"}</dd>
                    <dt className="text-muted-foreground">Promo Tag</dt>
                    <dd>{row.promoTag ?? "—"}</dd>
                  </dl>
                </button>
              );
            })}
          </div>
        </section>

        <section className={panel} aria-label={t("import.liveTitle", { line: selected.line })}>
          <h3 className={heading}>{t("import.liveTitle", { line: selected.line })}</h3>
          <div className="w-full max-w-[11rem] self-center">
            <ProductCard
              name={localizedName(locale, selected.name, selected.nameTh)}
              imageUrl={null}
              sku={selected.sku}
              size={selected.size}
              color={localizedName(locale, selected.colorName ?? selected.colorCode, selected.colorNameTh)}
              categoryName={localizedName(locale, selected.categoryName ?? selected.categoryCode, selected.categoryNameTh)}
              price={selected.priceSatang / 100}
              stockLabel={t("import.stockLabel", { count: selected.stock ?? 0 })}
              promoTag={selected.promoTag}
              sizes={sizes}
            />
          </div>
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {selected.costSatang === null
              ? t("import.costMissing")
              : t("import.costNote", { cost: formatBaht(selected.costSatang / 100) })}
          </p>
        </section>
      </div>
    </div>
  );
}
