import type { ZodType } from "zod";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { isAdminRole, type SessionUser } from "@/lib/auth/session";

/** Resolves the signed-in user, or an error response to return straight away. */
export async function requireUser(): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentSession();
  if (!user) return { response: apiError(401, "UNAUTHENTICATED", "Sign in to continue.") };
  return { user };
}

/**
 * Resolves the signed-in user and requires a manager or admin. The role is read from the database on every
 * call, so a demoted or deactivated account loses access at once, even while its session token is still valid.
 * Every /api/admin handler calls this itself instead of relying on the middleware alone.
 */
export async function requireManager(): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentSession();
  if (!user) return { response: apiError(401, "UNAUTHENTICATED", "Sign in to continue.") };
  if (!isAdminRole(user.role)) return { response: apiError(403, "FORBIDDEN", "Manager access required.") };
  return { user };
}

/** Reads and validates a JSON body. On failure returns the 400 response to send. */
export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<{ data: T } | { response: Response }> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { response: apiError(400, "INVALID_JSON", "Request body must be valid JSON.") };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      response: apiError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "The request is invalid.",
        parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      ),
    };
  }
  return { data: parsed.data };
}
