import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter the member's name.").max(100),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^0\d{8,9}$/, "Enter a valid phone number, for example 0812345678.")),
});

/** GET /api/admin/members?q=: members with their points and lifetime spend. */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const digits = normalizePhone(q);
  const members = await prisma.member.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
      : {},
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: PAGE_SIZE,
    select: { id: true, name: true, phone: true, points: true, isActive: true, createdAt: true, _count: { select: { orders: true } } },
  });

  const spend = await prisma.order.groupBy({
    by: ["memberId"],
    where: { memberId: { in: members.map((m) => m.id) }, status: { not: "VOIDED" } },
    _sum: { totalAmount: true, refundedAmount: true },
  });
  const spendById = new Map(
    spend.map((row) => [row.memberId, Number(row._sum.totalAmount ?? 0) - Number(row._sum.refundedAmount ?? 0)]),
  );

  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      points: m.points,
      isActive: m.isActive,
      createdAt: m.createdAt.toISOString(),
      orderCount: m._count.orders,
      totalSpent: (spendById.get(m.id) ?? 0).toFixed(2),
    })),
  });
}

/** POST /api/admin/members: registers a member. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, createSchema);
  if ("response" in body) return body.response;

  try {
    const member = await prisma.member.create({
      data: { name: body.data.name, phone: body.data.phone },
      select: { id: true, name: true, phone: true, points: true },
    });
    return Response.json({ member }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "DUPLICATE_PHONE", "A member already uses this phone number.");
    }
    console.error("[POST /api/admin/members]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not register the member.");
  }
}
