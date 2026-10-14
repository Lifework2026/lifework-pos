import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Enter a size.").max(20).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

/** PATCH /api/admin/sizes/[id]: renames a size (updating every variant that uses it) or changes its order. */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, patchSchema);
  if ("response" in body) return body.response;

  const existing = await prisma.size.findUnique({ where: { id: params.id } });
  if (!existing) return apiError(404, "NOT_FOUND", "Size not found.");

  if (body.data.name && body.data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await prisma.size.findFirst({
      where: { name: { equals: body.data.name, mode: "insensitive" }, NOT: { id: params.id } },
      select: { id: true },
    });
    if (duplicate) return apiError(409, "SIZE_EXISTS", "This size already exists.");
  }

  try {
    const size = await prisma.$transaction(async (tx) => {
      if (body.data.name && body.data.name !== existing.name) {
        // Variants keep the size as text, so a rename has to follow them.
        await tx.productVariant.updateMany({ where: { size: existing.name }, data: { size: body.data.name } });
      }
      return tx.size.update({
        where: { id: params.id },
        data: {
          ...(body.data.name ? { name: body.data.name } : {}),
          ...(body.data.sortOrder !== undefined ? { sortOrder: body.data.sortOrder } : {}),
        },
      });
    });
    return Response.json({ size });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "SIZE_CONFLICT", "Renaming would give a product two variants with the same size and color.");
    }
    console.error("[PATCH /api/admin/sizes/[id]]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not update the size.");
  }
}

/** DELETE /api/admin/sizes/[id]: a size that variants still use cannot be removed. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const existing = await prisma.size.findUnique({ where: { id: params.id } });
  if (!existing) return apiError(404, "NOT_FOUND", "Size not found.");
  const inUse = await prisma.productVariant.count({ where: { size: existing.name } });
  if (inUse > 0) return apiError(409, "SIZE_IN_USE", `${inUse} variant(s) use this size. Change them first.`);
  await prisma.size.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
