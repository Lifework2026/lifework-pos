import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { OrderError } from "@/lib/orders/errors";
import { serializeOrder } from "@/lib/orders/serialize";
import { runRefund, TRANSACTION_OPTIONS } from "@/lib/orders/returns";

export const dynamic = "force-dynamic";

const refundSchema = z.object({
  reason: z.string().trim().min(3, "Enter a reason for the refund.").max(300),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1, "Select at least one item.")
    .max(200),
  /** Reference for each refund channel that is not cash. Channels are decided by the original payments. */
  references: z
    .object({
      CARD: z.string().trim().max(100).optional(),
      QR_PROMPTPAY: z.string().trim().max(100).optional(),
      BANK_TRANSFER: z.string().trim().max(100).optional(),
      OTHER: z.string().trim().max(100).optional(),
    })
    .partial()
    .optional(),
});

/** POST /api/admin/orders/[id]/refund: refunds selected units, restocks them and reverses earned points. Managers only. */
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
  const parsed = refundSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request.", parsed.error.issues);
  }

  try {
    const result = await prisma.$transaction(
      (tx) =>
        runRefund(
          tx,
          params.id,
          {
            reason: parsed.data.reason,
            items: parsed.data.items,
            references: parsed.data.references ?? {},
          },
          session.id,
        ),
      TRANSACTION_OPTIONS,
    );
    return Response.json({ order: serializeOrder(result.order), refund: { id: result.refundId, amount: result.amount } }, { status: 201 });
  } catch (err) {
    if (err instanceof OrderError) return apiError(err.status, err.code, err.message, err.details);
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2025")) {
      return apiError(409, "CONFLICT", "The order changed while refunding. Refresh and try again.");
    }
    console.error("[POST /api/admin/orders/[id]/refund]", err);
    return apiError(500, "INTERNAL_ERROR", "Refund failed. Nothing was changed.");
  }
}
