import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import type { CategorySummary } from "@/lib/pos-types";

export const dynamic = "force-dynamic";

/** GET /api/categories: all categories, alphabetically, for the POS filter bar. */
export async function GET(): Promise<Response> {
  try {
    const categories: CategorySummary[] = await prisma.category.findMany({
      select: { id: true, name: true, nameTh: true, slug: true },
      orderBy: { name: "asc" },
    });
    return Response.json({ categories });
  } catch (err) {
    console.error("[GET /api/categories]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not load categories.");
  }
}
