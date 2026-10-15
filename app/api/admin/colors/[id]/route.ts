import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";
import { catalogCodeSchema } from "@/lib/master-schema";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  code: catalogCodeSchema.optional(),
  name: z.string().trim().min(1, "Enter the colour name.").max(40).optional(),
  nameTh: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

/**
 * PATCH /api/admin/colors/[id]: edits a colour. Renaming it also renames the text copy on every variant that uses it,
 * so the till, receipts and reports always show the current name.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, patchSchema);
  if ("response" in body) return body.response;
  const input = body.data;

  const current = await prisma.color.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!current) return apiError(404, "NOT_FOUND", "Colour not found.");
  if (input.code && (await prisma.color.findFirst({ where: { code: input.code, NOT: { id: params.id } }, select: { id: true } }))) {
    return apiError(409, "CODE_EXISTS", `Code ${input.code} is already used by another colour.`);
  }
  if (input.name && (await prisma.color.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id: params.id } }, select: { id: true } }))) {
    return apiError(409, "COLOR_EXISTS", "A colour with this name already exists.");
  }

  try {
    const color = await prisma.$transaction(
      async (tx) => {
        const updated = await tx.color.update({
          where: { id: params.id },
          data: {
            ...(input.code ? { code: input.code } : {}),
            ...(input.name ? { name: input.name } : {}),
            ...(input.nameTh !== undefined ? { nameTh: input.nameTh || null } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          },
          select: { id: true, code: true, name: true, nameTh: true, sortOrder: true },
        });
        if (input.name && input.name !== current.name) {
          await tx.productVariant.updateMany({ where: { colorId: params.id }, data: { color: input.name } });
        }
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return Response.json({ color });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "CONFLICT", "That code or name is already in use. Refresh and try again.");
    }
    throw err;
  }
}

/** DELETE /api/admin/colors/[id]: only a colour no variant uses can be removed. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const color = await prisma.color.findUnique({ where: { id: params.id }, select: { id: true, _count: { select: { variants: true } } } });
  if (!color) return apiError(404, "NOT_FOUND", "Colour not found.");
  if (color._count.variants > 0) {
    return apiError(409, "COLOR_IN_USE", `This colour is used by ${color._count.variants} variant(s). Change those variants first.`);
  }
  await prisma.color.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
