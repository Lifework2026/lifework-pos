import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { TEMPLATE_HEADER } from "@/lib/catalog/import";
import { buildTemplateWorkbook, loadMasterData, templateExample } from "@/lib/excel-templates";
import { toCsv } from "@/lib/tabular";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/products/import/template?format=xlsx|csv: Template A, the new-products file.
 * The Excel file is the same one the Excel bulk-actions page downloads, with the live Master_Data_Codes sheet.
 * Managers only.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const master = await loadMasterData();

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new Response(toCsv(TEMPLATE_HEADER, [templateExample("A", master)]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lifework-template-A-new-products.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const buffer = await buildTemplateWorkbook("A", master);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="lifework-template-A-new-products.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/products/import/template]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not build the template.");
  }
}
