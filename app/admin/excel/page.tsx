import { ExcelTools } from "@/components/admin/excel-tools";
import { getServerLocale, serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Bulk actions from spreadsheets: new products, price and promo updates, and stock in and out. Managers only. */
export default function ExcelPage() {
  const t = serverT(getServerLocale());
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("xls.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("xls.desc")}</p>
      </div>
      <ExcelTools />
    </div>
  );
}
