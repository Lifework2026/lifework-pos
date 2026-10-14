import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Enter the member's name.").max(100).optional(),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^0\d{8,9}$/, "Enter a valid phone number, for example 0812345678."))
    .optional(),
  isActive: z.boolean().optional(),
});

/** PATCH /api/admin/members/[id]: edits a member's name, phone or active status. */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, patchSchema);
  if ("response" in body) return body.response;

  const existing = await prisma.member.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "Member not found.");

  try {
    const member = await prisma.member.update({
      where: { id: params.id },
      data: body.data,
      select: { id: true, name: true, phone: true, points: true, isActive: true },
    });
    return Response.json({ member });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "DUPLICATE_PHONE", "A member already uses this phone number.");
    }
    console.error("[PATCH /api/admin/members/[id]]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not update the member.");
  }
}
