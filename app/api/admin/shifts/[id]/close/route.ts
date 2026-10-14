import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";
import { bahtToSatang } from "@/lib/shift-math";
import { closeShift } from "@/lib/shifts";
import { serializeClose, shiftErrorResponse } from "@/lib/shift-api";

export const dynamic = "force-dynamic";

const closeSchema = z.object({
  countedCash: z.number(),
  note: z.string().trim().max(300).nullable().optional(),
});

/** POST /api/admin/shifts/[id]/close: a manager closes a shift that was left open, from the counted cash. */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, closeSchema);
  if ("response" in body) return body.response;

  const counted = bahtToSatang(body.data.countedCash);
  if (counted === null) return apiError(400, "INVALID_COUNT", "Enter the cash counted in baht, with at most 2 decimals.");

  try {
    const result = await prisma.$transaction(
      (tx) => closeShift(tx, params.id, { countedSatang: counted, note: body.data.note ?? null, closedById: auth.user.id }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 },
    );
    return Response.json({ shift: serializeClose(result) });
  } catch (err) {
    return shiftErrorResponse(err, "POST /api/admin/shifts/[id]/close");
  }
}
