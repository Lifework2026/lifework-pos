import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { recordManualEdcPayment } from "@/lib/edc/service";
import { edcErrorResponse } from "@/lib/edc/http";

export const dynamic = "force-dynamic";

const manualSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  transactionRef: z.string().trim().min(4).max(64),
  approvalCode: z.string().trim().max(32).optional().nullable(),
});

/**
 * POST /api/edc/payments/manual: fallback when the bridge is down. The cashier
 * copies the reference and approval code from the terminal's slip.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = manualSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Enter the amount and the terminal transaction reference.");
  }

  try {
    const payment = await recordManualEdcPayment({
      amount: parsed.data.amount,
      transactionRef: parsed.data.transactionRef,
      approvalCode: parsed.data.approvalCode ?? null,
      userId: auth.user.id,
    });
    return Response.json({ payment }, { status: 201 });
  } catch (err) {
    return edcErrorResponse("POST /api/edc/payments/manual", err);
  }
}
