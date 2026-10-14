import { getCurrentSession } from "@/lib/auth/server";
import { apiError } from "@/lib/api";
import { refreshEdcPayment } from "@/lib/edc/service";
import { edcErrorResponse } from "@/lib/edc/http";

export const dynamic = "force-dynamic";

/** GET /api/edc/payments/[id]: current payment state. Asks the terminal while the payment is pending. */
export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  try {
    const payment = await refreshEdcPayment(params.id);
    return Response.json({ payment });
  } catch (err) {
    return edcErrorResponse("GET /api/edc/payments/[id]", err);
  }
}
