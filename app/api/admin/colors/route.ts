import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";
import { catalogCodeSchema } from "@/lib/master-schema";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: catalogCodeSchema,
  name: z.string().trim().min(1, "Enter the colour name.").max(40),
  nameTh: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

/** GET /api/admin/colors: the colour master data, with how many variants use each colour. */
export async function GET(): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const colors = await prisma.color.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, nameTh: true, sortOrder: true, _count: { select: { variants: true } } },
  });
  return Response.json({
    colors: colors.map((c) => ({ id: c.id, code: c.code, name: c.name, nameTh: c.nameTh, sortOrder: c.sortOrder, variantCount: c._count.variants })),
  });
}

/** POST /api/admin/colors: adds a colour. Codes and names are unique, names ignoring case. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, createSchema);
  if ("response" in body) return body.response;

  const { code, name } = body.data;
  if (await prisma.color.findUnique({ where: { code }, select: { id: true } })) {
    return apiError(409, "CODE_EXISTS", `Code ${code} is already used by another colour.`);
  }
  if (await prisma.color.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })) {
    return apiError(409, "COLOR_EXISTS", "A colour with this name already exists.");
  }
  const color = await prisma.color.create({
    data: { code, name, nameTh: body.data.nameTh || null, sortOrder: body.data.sortOrder ?? 0 },
    select: { id: true, code: true, name: true, nameTh: true, sortOrder: true },
  });
  return Response.json({ color }, { status: 201 });
}
