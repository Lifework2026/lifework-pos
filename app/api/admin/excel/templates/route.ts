import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { buildTemplateWorkbook, isTemplateType, TEMPLATES } from "@/lib/excel-templates";

export const dynamic = "force-dynamic";

/** GET /api/admin/excel/templates?type=A|B|C: downloads one of the bulk-action spreadsheets. Managers only. */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const type = request.nextUrl.searchParams.get("type");
  if (!isTemplateType(type)) return apiError(400, "INVALID_TYPE", "Choose template A, B or C.");

  const buffer = await buildTemplateWorkbook(type);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${TEMPLATES[type].file}"`,
      "Cache-Control": "no-store",
    },
  });
}
