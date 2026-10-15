import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout: clears the session cookie.
 * Refused while the signed-in user still has a cash-drawer shift open, so the drawer is always counted
 * before anyone leaves the till.
 */
export async function POST(): Promise<Response> {
  const user = await getCurrentSession();
  if (user) {
    const open = await prisma.shift.findFirst({ where: { userId: user.id, status: "OPEN" }, select: { id: true } });
    if (open) {
      return apiError(409, "SHIFT_OPEN", "Close your shift and declare the cash before signing out.", { shiftId: open.id });
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
