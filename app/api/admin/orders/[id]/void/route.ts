import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { OrderError } from "@/lib/orders/errors";
import { serializeOrder } from "@/lib/orders/serialize";
import { runVoid, TRANSACTION_OPTIONS } from "@/lib/orders/returns";

export const dynamic = "force-dynamic";

const voidSchema = z.object({
  reason: z.string().trim().min(3, "Enter a reason for the void.").max(300),
});

/** POST /api/admin/orders/[id]/void: voids a whole bill, restocks it and reverses member points. Managers only. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const session = auth.user;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = voidSchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request.");

  try {
    const order = await prisma.$transaction((tx) => runVoid(tx, params.id, parsed.data.reason, session.id), TRANSACTION_OPTIONS);
    return Response.json({ order: serializeOrder(order) });
  } catch (err) {
    if (err instanceof OrderError) return apiError(err.status, err.code, err.message, err.details);
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2025")) {
      return apiError(409, "CONFLICT", "The order changed while voiding. Refresh and try again.");
    }
    console.error("[POST /api/admin/orders/[id]/void]", err);
    return apiError(500, "INTERNAL_ERROR", "Void failed. Nothing was changed.");
  }
}
