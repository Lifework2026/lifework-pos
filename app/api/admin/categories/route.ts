import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(80),
  nameTh: z.string().trim().max(80).nullable().optional(),
});

/** GET /api/admin/categories: every category with how many products it holds. */
export async function GET(): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, nameTh: true, slug: true, _count: { select: { products: true } } },
  });
  return Response.json({
    categories: categories.map((c) => ({ id: c.id, name: c.name, nameTh: c.nameTh, slug: c.slug, productCount: c._count.products })),
  });
}

/** POST /api/admin/categories: adds a category. Names are unique, ignoring case. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, createSchema);
  if ("response" in body) return body.response;

  const name = body.data.name;
  const duplicate = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (duplicate) return apiError(409, "CATEGORY_EXISTS", "A category with this name already exists.");

  const base = slugify(name);
  const taken = new Set((await prisma.category.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((c) => c.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;

  const category = await prisma.category.create({
    data: { name, nameTh: body.data.nameTh || null, slug },
    select: { id: true, name: true, nameTh: true, slug: true },
  });
  return Response.json({ category }, { status: 201 });
}
