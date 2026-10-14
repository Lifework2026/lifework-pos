import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySessionToken, type SessionUser } from "@/lib/auth/session";

/**
 * Resolves the signed-in user for server components and route handlers.
 * Re-reads the user from the database, so deactivated accounts lose access
 * immediately and role changes apply without waiting for the token to expire.
 */
export async function getCurrentSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.id },
    select: { id: true, username: true, fullName: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}
