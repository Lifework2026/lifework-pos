import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter a size.").max(20),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

/** GET /api/admin/sizes: the managed size list with how many variants use each size. */
export async function GET(): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const [sizes, usage] = await Promise.all([
    prisma.size.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productVariant.groupBy({ by: ["size"], _count: { _all: true } }),
  ]);
  const used = new Map(usage.map((row) => [row.size, row._count._all]));
  return Response.json({
    sizes: sizes.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, variantCount: used.get(s.name) ?? 0 })),
  });
}

/** POST /api/admin/sizes: adds a size. Names are unique, ignoring case. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, createSchema);
  if ("response" in body) return body.response;

  const duplicate = await prisma.size.findFirst({ where: { name: { equals: body.data.name, mode: "insensitive" } }, select: { id: true } });
  if (duplicate) return apiError(409, "SIZE_EXISTS", "This size already exists.");

  let sortOrder = body.data.sortOrder;
  if (sortOrder === undefined) {
    const last = await prisma.size.aggregate({ _max: { sortOrder: true } });
    sortOrder = (last._max.sortOrder ?? 0) + 1;
  }
  const size = await prisma.size.create({ data: { name: body.data.name, sortOrder } });
  return Response.json({ size }, { status: 201 });
}
