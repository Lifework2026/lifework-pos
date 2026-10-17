import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { CLEAR_DEMO_PHRASE, isLegacyCategoryCode, isLegacyColorCode, planDemoClear } from "@/lib/master-demo";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/master-data/clear-demo (JSON: { confirm: "CLEAR DEMO" })
 *
 * Deletes the legacy demo categories and colours that nothing uses. The delete repeats the usage check in the same
 * serializable transaction, so a product or promotion added a moment earlier still protects its code. Managers only.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  let confirm: unknown = null;
  try {
    confirm = ((await request.json()) as { confirm?: unknown }).confirm;
  } catch {
    confirm = null;
  }
  if (confirm !== CLEAR_DEMO_PHRASE) {
    return apiError(400, "CONFIRM_REQUIRED", `Type ${CLEAR_DEMO_PHRASE} to confirm.`);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const [categories, colors] = await Promise.all([
          tx.category.findMany({
            select: { id: true, code: true, _count: { select: { products: true, promotions: true } } },
          }),
          tx.color.findMany({
            select: { id: true, code: true, _count: { select: { variants: true } } },
          }),
        ]);
        const categoryPlan = planDemoClear(
          categories.map((c) => ({ id: c.id, code: c.code, uses: c._count.products + c._count.promotions })),
          isLegacyCategoryCode,
        );
        const colorPlan = planDemoClear(colors.map((c) => ({ id: c.id, code: c.code, uses: c._count.variants })), isLegacyColorCode);

        // The where clause repeats the usage check, so a row that gained a user since the read is kept.
        const removedCategories = categoryPlan.remove.length
          ? await tx.category.deleteMany({
              where: {
                id: { in: categoryPlan.remove.map((c) => c.id) },
                products: { none: {} },
                promotions: { none: {} },
              },
            })
          : { count: 0 };
        const removedColors = colorPlan.remove.length
          ? await tx.color.deleteMany({
              where: { id: { in: colorPlan.remove.map((c) => c.id) }, variants: { none: {} } },
            })
          : { count: 0 };

        const removedCodes = {
          categories: categoryPlan.remove.map((c) => c.code),
          colors: colorPlan.remove.map((c) => c.code),
        };
        const kept = [...categoryPlan.keep, ...colorPlan.keep];
        await tx.auditLog.create({
          data: {
            action: "MASTER_DATA_CLEAR_DEMO",
            entityType: "MasterData",
            entityId: "demo",
            userId: auth.user.id,
            reason: `${removedCategories.count} categories and ${removedColors.count} colours removed; ${kept.length} kept in use`,
            details: { removed: removedCodes, kept },
          },
        });
        return { removedCategories: removedCategories.count, removedColors: removedColors.count, kept };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 },
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      return apiError(409, "CONFLICT", "The master data changed at the same time. Nothing was removed. Please try again.");
    }
    console.error("[POST /api/admin/master-data/clear-demo]", err);
    return apiError(500, "INTERNAL_ERROR", "Nothing was removed.");
  }
}
