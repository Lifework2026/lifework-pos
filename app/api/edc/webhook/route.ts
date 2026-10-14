import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { handleEdcWebhook, isValidWebhookSecret } from "@/lib/edc/service";
import { edcErrorResponse } from "@/lib/edc/http";

export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  sessionId: z.string().min(1).max(128),
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELLED", "TIMEOUT"]),
  transactionRef: z.string().max(64).optional(),
  approvalCode: z.string().max(32).nullable().optional(),
  cardMask: z.string().max(32).nullable().optional(),
  reason: z.string().max(200).optional(),
});

/**
 * POST /api/edc/webhook: status pushed by the terminal bridge. It is not behind
 * the session middleware, so the shared secret in `x-edc-secret` is the only check.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!process.env.EDC_WEBHOOK_SECRET) {
    return apiError(503, "WEBHOOK_DISABLED", "EDC webhook is not configured.");
  }
  if (!isValidWebhookSecret(request.headers.get("x-edc-secret"))) {
    return apiError(401, "INVALID_SECRET", "Webhook secret is missing or wrong.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "Webhook payload is invalid.");

  try {
    const payment = await handleEdcWebhook({
      ...parsed.data,
      transactionRef: parsed.data.transactionRef ?? "",
      approvalCode: parsed.data.approvalCode ?? null,
      cardMask: parsed.data.cardMask ?? null,
    });
    if (!payment) return apiError(404, "EDC_SESSION_NOT_FOUND", "No payment matches this session.");
    return Response.json({ payment });
  } catch (err) {
    return edcErrorResponse("POST /api/edc/webhook", err);
  }
}
