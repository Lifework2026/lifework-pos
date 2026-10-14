import { getCurrentSession } from "@/lib/auth/server";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/auth/me: the signed-in user, or 401. */
export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) {
    return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  return Response.json({ user: session });
}
