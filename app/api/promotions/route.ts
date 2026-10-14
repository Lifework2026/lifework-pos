import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import type { PromotionSummary } from "@/lib/pos-types";

export const dynamic = "force-dynamic";

/** GET /api/promotions: promotions that are active and running right now, for the checkout list. */
export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  const now = new Date();
  const rows = await prisma.promotion.findMany({
    where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { name: "asc" },
  });

  const promotions: PromotionSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    scope: row.scope,
    value: row.value.toFixed(2),
    minSubtotal: row.minSubtotal.toFixed(2),
    endsAt: row.endsAt.toISOString(),
  }));
  return Response.json({ promotions });
}
