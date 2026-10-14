// Import the JWT modules directly. The package root also pulls in encryption code that Edge rejects.
import { jwtVerify } from "jose/jwt/verify";
import { SignJWT } from "jose/jwt/sign";

/**
 * Session token helpers. Edge-safe: no Prisma or Node-only imports, so this
 * module can run inside middleware as well as in route handlers.
 */

export const SESSION_COOKIE = "lw_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export const USER_ROLES = ["ADMIN", "MANAGER", "CASHIER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

function signingKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ username: user.username, fullName: user.fullName, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(signingKey());
}

/** Returns the session user if the token is valid and unexpired, otherwise null. */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] });
    const { sub, username, fullName, role } = payload;

    if (typeof sub !== "string" || typeof username !== "string" || typeof fullName !== "string") {
      return null;
    }
    if (typeof role !== "string" || !(USER_ROLES as readonly string[]).includes(role)) {
      return null;
    }
    return { id: sub, username, fullName, role: role as UserRole };
  } catch {
    return null;
  }
}

export function isAdminRole(role: UserRole): boolean {
  return role === "ADMIN" || role === "MANAGER";
}
