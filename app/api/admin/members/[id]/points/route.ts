import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const adjustSchema = z.object({
  delta: z
    .number()
    .int("Points must be a whole number.")
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, "Enter a number other than zero."),
  reason: z.string().trim().min(3, "Enter a reason for the adjustment.").max(300),
});

/**
 * POST /api/admin/members/[id]/points: adds or removes points by hand, for example a goodwill bonus
 * or a correction. The balance can never go below zero. Every adjustment is written to the audit log.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, adjustSchema);
  if ("response" in body) return body.response;
  const { delta, reason } = body.data;

  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({ where: { id: params.id }, select: { id: true, name: true, points: true } });
    if (!member) return { ok: false as const, response: apiError(404, "NOT_FOUND", "Member not found.") };
    if (member.points + delta < 0) {
      return { ok: false as const, response: apiError(409, "INSUFFICIENT_POINTS", `The member only has ${member.points} points.`) };
    }

    // Guarded on the balance we read, so two staff adjusting at once cannot lose an update.
    const updated = await tx.member.updateMany({
      where: { id: member.id, points: member.points },
      data: { points: member.points + delta },
    });
    if (updated.count !== 1) {
      return { ok: false as const, response: apiError(409, "CONFLICT", "The balance changed at the same time. Please try again.") };
    }

    await tx.auditLog.create({
      data: {
        action: "MEMBER_POINTS_ADJUST",
        entityType: "Member",
        entityId: member.id,
        reason,
        userId: auth.user.id,
        details: { name: member.name, before: member.points, after: member.points + delta, delta },
      },
    });
    return { ok: true as const, points: member.points + delta };
  });

  if (!result.ok) return result.response;
  return Response.json({ points: result.points });
}
