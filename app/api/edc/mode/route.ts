import { getCurrentSession } from "@/lib/auth/server";
import { apiError } from "@/lib/api";
import { resolveEdcMode } from "@/lib/edc/mode";

export const dynamic = "force-dynamic";

/** GET /api/edc/mode: how card payments are taken here, so the till shows the right card screen. */
export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return Response.json({ mode: resolveEdcMode(process.env) });
}
