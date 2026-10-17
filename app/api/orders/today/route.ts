import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { isAdminRole } from "@/lib/auth/session";
import { bangkokDayRange, bangkokYmd } from "@/lib/bangkok";
import { prisma } from "@/lib/prisma";
import { orderSelect, serializeOrder } from "@/lib/orders/serialize";

export const dynamic = "force-dynamic";

const MAX_BILLS = 300;

/**
 * GET /api/orders/today
 *
 * The bills of today in store time (Bangkok), newest first, in the same shape the receipt uses, so any of them can be
 * printed again. A cashier sees their own bills; an admin or manager sees every cashier's. Read only.
 */
export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  try {
    const { start, end } = bangkokDayRange(bangkokYmd());
    const everyone = isAdminRole(session.role);
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(everyone ? {} : { cashierId: session.id }) },
      select: orderSelect,
      orderBy: { createdAt: "desc" },
      take: MAX_BILLS,
    });
    return Response.json({ orders: orders.map(serializeOrder), scope: everyone ? "ALL" : "OWN" });
  } catch (err) {
    console.error("[GET /api/orders/today]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not load today's sales.");
  }
}
