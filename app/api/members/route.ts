import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { requireManager } from "@/lib/api-helpers";
import type { MemberSummary } from "@/lib/pos-types";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter the member's name.").max(100),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^0\d{8,9}$/, "Enter a valid phone number, for example 0812345678.")),
});

const memberSelect = { id: true, name: true, phone: true, points: true } as const;

/** GET /api/members?q=: finds active members by phone digits or by name. */
export async function GET(request: NextRequest): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!q) return Response.json({ members: [] satisfies MemberSummary[] });

  const digits = normalizePhone(q);
  const members = await prisma.member.findMany({
    where: {
      isActive: true,
      OR:
        digits.length >= 3
          ? [{ phone: { startsWith: digits } }, { name: { contains: q, mode: "insensitive" } }]
          : [{ name: { contains: q, mode: "insensitive" } }],
    },
    select: memberSelect,
    orderBy: { name: "asc" },
    take: 10,
  });
  return Response.json({ members: members satisfies MemberSummary[] });
}

/** POST /api/members: registers a new member. A phone number can belong to one member only. */
export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid member.");

  const existing = await prisma.member.findUnique({ where: { phone: parsed.data.phone }, select: memberSelect });
  if (existing) {
    return apiError(409, "DUPLICATE_PHONE", "A member already uses this phone number.", { member: existing });
  }

  try {
    const member = await prisma.member.create({
      data: { name: parsed.data.name, phone: parsed.data.phone },
      select: memberSelect,
    });
    return Response.json({ member: member satisfies MemberSummary }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/members]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not register the member.");
  }
}
