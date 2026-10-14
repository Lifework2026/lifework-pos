import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/api-helpers";
import { TEMPLATE_EXAMPLE_ROWS, TEMPLATE_HEADER } from "@/lib/catalog/import";
import { buildXlsx, toCsv } from "@/lib/tabular";

export const dynamic = "force-dynamic";

/** GET /api/admin/products/import/template?format=xlsx|csv: the file managers fill in for a bulk import. */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";

  if (format === "csv") {
    return new Response(toCsv(TEMPLATE_HEADER, TEMPLATE_EXAMPLE_ROWS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lifework-product-import-template.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    // SKU (0) and Barcode (7) stay text so Excel keeps leading zeros.
    const buffer = await buildXlsx("Products", TEMPLATE_HEADER, TEMPLATE_EXAMPLE_ROWS, {
      textColumns: [0, 7],
      widths: [16, 28, 16, 8, 10, 8, 12, 16, 14, 28, 16, 30],
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="lifework-product-import-template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/products/import/template]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not build the template.");
  }
}
