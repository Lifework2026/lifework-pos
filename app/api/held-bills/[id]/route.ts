import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** DELETE /api/held-bills/[id]: discards a parked bill without resuming it. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const result = await prisma.heldBill.deleteMany({ where: { id: params.id } });
  if (result.count === 0) return apiError(404, "NOT_FOUND", "That held bill no longer exists.");
  return Response.json({ ok: true });
}
