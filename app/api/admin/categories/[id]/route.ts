import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(80).optional(),
  nameTh: z.string().trim().max(80).nullable().optional(),
});

/** PATCH /api/admin/categories/[id]: renames a category. The slug stays the same. */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, patchSchema);
  if ("response" in body) return body.response;

  const existing = await prisma.category.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "Category not found.");

  if (body.data.name) {
    const duplicate = await prisma.category.findFirst({
      where: { name: { equals: body.data.name, mode: "insensitive" }, NOT: { id: params.id } },
      select: { id: true },
    });
    if (duplicate) return apiError(409, "CATEGORY_EXISTS", "A category with this name already exists.");
  }

  const category = await prisma.category.update({
    where: { id: params.id },
    data: {
      ...(body.data.name ? { name: body.data.name } : {}),
      ...(body.data.nameTh !== undefined ? { nameTh: body.data.nameTh || null } : {}),
    },
    select: { id: true, name: true, nameTh: true, slug: true },
  });
  return Response.json({ category });
}

/** DELETE /api/admin/categories/[id]: only an empty category can be removed. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const category = await prisma.category.findUnique({
    where: { id: params.id },
    select: { id: true, _count: { select: { products: true } } },
  });
  if (!category) return apiError(404, "NOT_FOUND", "Category not found.");
  if (category._count.products > 0) {
    return apiError(409, "CATEGORY_IN_USE", `This category still has ${category._count.products} product(s). Move or remove them first.`);
  }
  await prisma.category.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
