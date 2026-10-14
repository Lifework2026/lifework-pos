import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/server";
import { apiError } from "@/lib/api";
import { startEdcPayment } from "@/lib/edc/service";
import { edcErrorResponse } from "@/lib/edc/http";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  amount: z.number().positive().max(1_000_000),
});

/** POST /api/edc/payments: sends the amount to the card terminal and returns a PENDING payment. */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = startSchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "Amount must be a positive number.");

  try {
    const payment = await startEdcPayment({ amount: parsed.data.amount, userId: session.id });
    return Response.json({ payment }, { status: 201 });
  } catch (err) {
    return edcErrorResponse("POST /api/edc/payments", err);
  }
}
