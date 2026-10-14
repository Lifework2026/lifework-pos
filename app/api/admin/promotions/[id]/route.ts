import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ isActive: z.boolean() });

/** PATCH /api/admin/promotions/[id]: switches a promotion on or off. Managers only. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "Send { isActive: true | false }.");

  const existing = await prisma.promotion.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "Promotion not found.");

  const promotion = await prisma.promotion.update({
    where: { id: params.id },
    data: { isActive: parsed.data.isActive },
  });
  return Response.json({ promotion });
}
