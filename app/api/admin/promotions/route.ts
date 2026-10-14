import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import { bahtToSatang } from "@/lib/pricing";
import { promotionSchema } from "@/lib/promotions-schema";

export const dynamic = "force-dynamic";

/** GET /api/admin/promotions: every promotion, active first. */
export async function GET(): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const promotions = await prisma.promotion.findMany({
    orderBy: [{ isActive: "desc" }, { endsAt: "desc" }],
    include: { category: { select: { name: true } } },
  });
  return Response.json({ promotions });
}

/** POST /api/admin/promotions: creates a promotion. Managers only (enforced by middleware). */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, promotionSchema);
  if ("response" in body) return body.response;
  const input = body.data;

  if (input.scope === "CATEGORY") {
    const category = await prisma.category.findUnique({ where: { id: input.categoryId ?? "" }, select: { id: true } });
    if (!category) return apiError(400, "CATEGORY_NOT_FOUND", "Choose a valid category.");
  }
  if (input.code) {
    const clash = await prisma.promotion.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) return apiError(409, "CODE_EXISTS", "Another promotion already uses this code.");
  }

  // Baht values are stored with two decimals. Reject anything more precise.
  bahtToSatang(input.minSubtotal);
  if (input.kind === "AMOUNT_OFF") bahtToSatang(input.value);

  const promotion = await prisma.promotion.create({
    data: {
      name: input.name,
      code: input.code ?? null,
      kind: input.kind,
      scope: input.scope,
      value: input.value,
      categoryId: input.scope === "CATEGORY" ? (input.categoryId ?? null) : null,
      minSubtotal: input.minSubtotal,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    },
  });
  await prisma.auditLog.create({
    data: { action: "PROMOTION_CREATE", entityType: "Promotion", entityId: promotion.id, userId: auth.user.id, details: { name: promotion.name } },
  });
  return Response.json({ promotion }, { status: 201 });
}
