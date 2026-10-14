import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import { bahtToSatang } from "@/lib/pricing";
import { promotionPatchSchema, promotionSchema } from "@/lib/promotions-schema";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/promotions/[id]: switches a promotion on or off, or edits it.
 * The edited promotion is validated as a whole, with the same rules as creating one.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, promotionPatchSchema);
  if ("response" in body) return body.response;
  const patch = body.data;

  const existing = await prisma.promotion.findUnique({ where: { id: params.id } });
  if (!existing) return apiError(404, "NOT_FOUND", "Promotion not found.");

  const { isActive, ...fields } = patch;
  const editsFields = Object.values(fields).some((value) => value !== undefined);

  let update: Prisma.PromotionUpdateInput = {};
  if (isActive !== undefined) update.isActive = isActive;

  if (editsFields) {
    const merged = promotionSchema.safeParse({
      name: patch.name ?? existing.name,
      code: patch.code === undefined ? existing.code : patch.code || null,
      kind: patch.kind ?? existing.kind,
      scope: patch.scope ?? existing.scope,
      value: patch.value ?? Number(existing.value),
      categoryId: patch.categoryId === undefined ? existing.categoryId : patch.categoryId,
      minSubtotal: patch.minSubtotal ?? Number(existing.minSubtotal),
      startsAt: patch.startsAt ?? existing.startsAt.toISOString(),
      endsAt: patch.endsAt ?? existing.endsAt.toISOString(),
    });
    if (!merged.success) {
      return apiError(400, "VALIDATION_ERROR", merged.error.issues[0]?.message ?? "The promotion is invalid.", merged.error.issues);
    }
    const input = merged.data;

    if (input.scope === "CATEGORY") {
      const category = await prisma.category.findUnique({ where: { id: input.categoryId ?? "" }, select: { id: true } });
      if (!category) return apiError(400, "CATEGORY_NOT_FOUND", "Choose a valid category.");
    }
    if (input.code && input.code !== existing.code) {
      const clash = await prisma.promotion.findUnique({ where: { code: input.code }, select: { id: true } });
      if (clash) return apiError(409, "CODE_EXISTS", "Another promotion already uses this code.");
    }
    bahtToSatang(input.minSubtotal);
    if (input.kind === "AMOUNT_OFF") bahtToSatang(input.value);

    update = {
      ...update,
      name: input.name,
      code: input.code ?? null,
      kind: input.kind,
      scope: input.scope,
      value: input.value,
      category: input.scope === "CATEGORY" && input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true },
      minSubtotal: input.minSubtotal,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    };
  }

  const promotion = await prisma.promotion.update({ where: { id: params.id }, data: update });
  await prisma.auditLog.create({
    data: {
      action: editsFields ? "PROMOTION_EDIT" : isActive ? "PROMOTION_ON" : "PROMOTION_OFF",
      entityType: "Promotion",
      entityId: promotion.id,
      userId: auth.user.id,
      details: { name: promotion.name },
    },
  });
  return Response.json({ promotion });
}
