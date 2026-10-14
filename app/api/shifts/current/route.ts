import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-helpers";
import { satangToDecimal } from "@/lib/pricing";
import { computeShiftTotals, getOpenShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

/**
 * GET /api/shifts/current: the signed-in user's open shift, or null. Reports receipts and sales so far,
 * but never the expected cash, so the closing count is done blind.
 */
export async function GET(): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const shift = await getOpenShift(prisma, auth.user.id);
  if (!shift) return Response.json({ shift: null });

  const totals = await computeShiftTotals(prisma, shift.id);
  return Response.json({
    shift: {
      id: shift.id,
      openedAt: shift.openedAt.toISOString(),
      openingFloat: shift.openingFloat.toFixed(2),
      orderCount: totals.orderCount - totals.voidedCount,
      salesTotal: satangToDecimal(totals.salesTotal),
    },
  });
}
