import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { bahtToSatang } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const promotionSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a promotion name.").max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,20}$/, "Code must be 3 to 20 letters, digits or dashes.")
      .nullable()
      .optional(),
    kind: z.enum(["PERCENT_OFF", "AMOUNT_OFF"]),
    scope: z.enum(["ORDER", "CATEGORY"]),
    value: z.number().positive("Enter a value above zero.").max(1_000_000),
    categoryId: z.string().min(1).nullable().optional(),
    minSubtotal: z.number().nonnegative().max(10_000_000).default(0),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "PERCENT_OFF" && value.value > 100) {
      ctx.addIssue({ code: "custom", message: "A percentage cannot be more than 100.", path: ["value"] });
    }
    if (value.scope === "CATEGORY" && !value.categoryId) {
      ctx.addIssue({ code: "custom", message: "Choose the category this promotion applies to.", path: ["categoryId"] });
    }
    if (new Date(value.endsAt) <= new Date(value.startsAt)) {
      ctx.addIssue({ code: "custom", message: "End time must be after start time.", path: ["endsAt"] });
    }
  });

/** GET /api/admin/promotions: every promotion, newest first. */
export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const promotions = await prisma.promotion.findMany({
    orderBy: [{ isActive: "desc" }, { endsAt: "desc" }],
    include: { category: { select: { name: true } } },
  });
  return Response.json({ promotions });
}

/** POST /api/admin/promotions: creates a promotion. Managers only (enforced by middleware). */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = promotionSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Promotion is invalid.", parsed.error.issues);
  }
  const input = parsed.data;

  if (input.scope === "CATEGORY") {
    const category = await prisma.category.findUnique({ where: { id: input.categoryId ?? "" }, select: { id: true } });
    if (!category) return apiError(400, "CATEGORY_NOT_FOUND", "Choose a valid category.");
  }
  if (input.code) {
    const clash = await prisma.promotion.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) return apiError(409, "CODE_EXISTS", "Another promotion already uses this code.");
  }

  // Baht values are stored with two decimals. Reject anything more precise.
  bahtToSatang(input.minSubtotal);
  if (input.kind === "AMOUNT_OFF") bahtToSatang(input.value);

  const promotion = await prisma.promotion.create({
    data: {
      name: input.name,
      code: input.code ?? null,
      kind: input.kind,
      scope: input.scope,
      value: input.value,
      categoryId: input.scope === "CATEGORY" ? input.categoryId ?? null : null,
      minSubtotal: input.minSubtotal,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    },
  });
  return Response.json({ promotion }, { status: 201 });
}
