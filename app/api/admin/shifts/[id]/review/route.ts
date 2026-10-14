import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({ note: z.string().trim().max(300).nullable().optional() });

/** POST /api/admin/shifts/[id]/review: a manager signs off a closed shift, optionally with a note. */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, reviewSchema);
  if ("response" in body) return body.response;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.shift.updateMany({
      where: { id: params.id, status: "CLOSED", reviewedAt: null },
      data: { reviewedAt: new Date(), reviewedById: auth.user.id, reviewNote: body.data.note?.trim() || null },
    });
    if (updated.count !== 1) return null;
    await tx.auditLog.create({
      data: {
        action: "SHIFT_REVIEW",
        entityType: "Shift",
        entityId: params.id,
        userId: auth.user.id,
        reason: body.data.note?.trim() || null,
      },
    });
    return true;
  });
  if (!result) return apiError(409, "NOT_REVIEWABLE", "Only a closed shift that has not been reviewed can be signed off.");
  return Response.json({ ok: true });
}
