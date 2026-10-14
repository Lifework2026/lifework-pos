import { getCurrentSession } from "@/lib/auth/server";
import { apiError } from "@/lib/api";
import { cancelEdcPayment } from "@/lib/edc/service";
import { edcErrorResponse } from "@/lib/edc/http";

export const dynamic = "force-dynamic";

/** POST /api/edc/payments/[id]/cancel: asks the terminal to cancel a pending card payment. */
export async function POST(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  try {
    const payment = await cancelEdcPayment(params.id);
    return Response.json({ payment });
  } catch (err) {
    return edcErrorResponse("POST /api/edc/payments/[id]/cancel", err);
  }
}
