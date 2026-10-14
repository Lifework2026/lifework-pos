import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import { bahtToSatang } from "@/lib/shift-math";
import { closeShift, getOpenShift, ShiftError } from "@/lib/shifts";
import { serializeClose, shiftErrorResponse } from "@/lib/shift-api";

export const dynamic = "force-dynamic";

const closeSchema = z.object({
  countedCash: z.number(),
  note: z.string().trim().max(300).nullable().optional(),
});

/**
 * POST /api/shifts/current/close: the cashier declares the cash counted in the drawer. The expected amount is
 * computed on the server from the receipts. A difference needs a written explanation.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, closeSchema);
  if ("response" in body) return body.response;

  const counted = bahtToSatang(body.data.countedCash);
  if (counted === null) return apiError(400, "INVALID_COUNT", "Enter the cash you counted in baht, with at most 2 decimals.");

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const shift = await getOpenShift(tx, auth.user.id);
        if (!shift) throw new ShiftError(404, "NO_OPEN_SHIFT", "You have no open shift to close.");
        return closeShift(tx, shift.id, {
          countedSatang: counted,
          note: body.data.note ?? null,
          closedById: auth.user.id,
          requireOwnerId: auth.user.id,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 },
    );
    return Response.json({ shift: serializeClose(result) });
  } catch (err) {
    return shiftErrorResponse(err, "POST /api/shifts/current/close");
  }
}
