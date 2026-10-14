import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import { bahtToSatang } from "@/lib/shift-math";
import { openShift } from "@/lib/shifts";
import { shiftErrorResponse } from "@/lib/shift-api";
import { satangToDecimal } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const openSchema = z.object({
  openingFloat: z.number(),
  note: z.string().trim().max(200).nullable().optional(),
});

/** POST /api/shifts: opens the signed-in user's cash-drawer shift with the declared starting cash. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, openSchema);
  if ("response" in body) return body.response;

  const float = bahtToSatang(body.data.openingFloat);
  if (float === null) return apiError(400, "INVALID_FLOAT", "Enter the starting cash in baht, with at most 2 decimals.");

  try {
    const shift = await prisma.$transaction((tx) => openShift(tx, auth.user.id, float, body.data.note?.trim() || null));
    return Response.json(
      {
        shift: {
          id: shift.id,
          openedAt: shift.openedAt.toISOString(),
          openingFloat: satangToDecimal(float),
          orderCount: 0,
          salesTotal: "0.00",
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return shiftErrorResponse(err, "POST /api/shifts");
  }
}
