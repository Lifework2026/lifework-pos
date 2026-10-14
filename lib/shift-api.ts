import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { OrderError } from "@/lib/orders/errors";
import { satangToDecimal } from "@/lib/pricing";
import type { ShiftCloseResult } from "@/lib/shifts";

/** Shared by the cashier and manager close routes. */
export function shiftErrorResponse(err: unknown, label: string): Response {
  if (err instanceof OrderError) return apiError(err.status, err.code, err.message, err.details);
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2025")) {
    return apiError(409, "CONFLICT", "The shift changed while saving. Refresh and try again.");
  }
  console.error(`[${label}]`, err);
  return apiError(500, "INTERNAL_ERROR", "Could not save the shift. Nothing was changed.");
}

/** JSON shape of a closed shift, with money as fixed 2dp strings. */
export function serializeClose(result: ShiftCloseResult) {
  const baht = (satang: number) => satangToDecimal(satang);
  return {
    id: result.id,
    openedAt: result.openedAt.toISOString(),
    closedAt: result.closedAt.toISOString(),
    openingFloat: result.openingFloat,
    expectedCash: result.expectedCash,
    countedCash: result.countedCash,
    variance: result.variance,
    orderCount: result.totals.orderCount,
    voidedCount: result.totals.voidedCount,
    salesTotal: baht(result.totals.salesTotal),
    cashSales: baht(result.totals.cashSales),
    cashRefunds: baht(result.totals.cashRefunds),
    cashVoids: baht(result.totals.cashVoids),
  };
}
