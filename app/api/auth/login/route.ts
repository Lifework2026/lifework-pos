import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const INVALID_CREDENTIALS = "Invalid username or password.";

/** POST /api/auth/login: verifies credentials and sets the signed session cookie. */
export async function POST(request: NextRequest): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Enter both username and password.");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
    });

    if (!user || !user.isActive || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return apiError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
    }

    const token = await createSessionToken({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    });

    const response = NextResponse.json({
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return apiError(500, "INTERNAL_ERROR", "Sign-in failed. Please try again.");
  }
}
