import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const MAX_LINES = 200;
const MAX_QUANTITY = 100_000;

const receiveSchema = z
  .object({
    type: z.enum(["STOCK_IN", "ADJUSTMENT"]),
    reference: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
    lines: z
      .array(
        z.object({
          variantId: z.string().min(1),
          quantityChange: z.number().int().min(-MAX_QUANTITY).max(MAX_QUANTITY),
        }),
      )
      .min(1)
      .max(MAX_LINES),
  })
  .superRefine((value, ctx) => {
    if (value.type === "STOCK_IN" && value.lines.some((line) => line.quantityChange <= 0)) {
      ctx.addIssue({ code: "custom", message: "Received quantities must be greater than zero.", path: ["lines"] });
    }
    if (value.type === "ADJUSTMENT") {
      if (value.lines.some((line) => line.quantityChange === 0)) {
        ctx.addIssue({ code: "custom", message: "Adjustment quantities cannot be zero.", path: ["lines"] });
      }
      if (!value.note || value.note.length < 3) {
        ctx.addIssue({ code: "custom", message: "Adjustments need a reason note.", path: ["note"] });
      }
    }
  });

class InventoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

interface StockOutcome {
  variantId: string;
  sku: string;
  productName: string;
  quantityChange: number;
  stockBefore: number;
  stockAfter: number;
}

/**
 * POST /api/admin/inventory/receive
 *
 * Records inbound stock (STOCK_IN) or a counted correction (ADJUSTMENT). Each line
 * updates the variant's stock and writes an InventoryMovement, in one serializable
 * transaction. A negative change that would drop stock below zero rolls back the whole batch.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = receiveSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Stock change is invalid.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }

  const input = parsed.data;

  // Merge repeated variants so each one is updated once.
  const deltas = new Map<string, number>();
  for (const line of input.lines) {
    deltas.set(line.variantId, (deltas.get(line.variantId) ?? 0) + line.quantityChange);
  }

  try {
    const outcomes = await prisma.$transaction(
      async (tx) => {
        const variantIds = Array.from(deltas.keys());
        const variants = await tx.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            isActive: true,
            stockQuantity: true,
            product: { select: { name: true } },
          },
        });
        if (variants.length !== variantIds.length) {
          throw new InventoryError(404, "VARIANT_NOT_FOUND", "One or more variants do not exist.");
        }

        const results: StockOutcome[] = [];

        for (const variant of variants) {
          const delta = deltas.get(variant.id) ?? 0;
          if (!variant.isActive) {
            throw new InventoryError(409, "VARIANT_INACTIVE", `${variant.sku} is inactive and cannot be stocked.`);
          }

          // Guard against going negative. The check and the write happen in one statement.
          const result = await tx.productVariant.updateMany({
            where: { id: variant.id, stockQuantity: { gte: Math.max(0, -delta) } },
            data: { stockQuantity: { increment: delta } },
          });
          if (result.count !== 1) {
            throw new InventoryError(409, "INSUFFICIENT_STOCK", `Not enough stock of ${variant.sku} for this adjustment.`, {
              variantId: variant.id,
              available: variant.stockQuantity,
              requested: -delta,
            });
          }

          results.push({
            variantId: variant.id,
            sku: variant.sku,
            productName: variant.product.name,
            quantityChange: delta,
            stockBefore: variant.stockQuantity,
            stockAfter: variant.stockQuantity + delta,
          });
        }

        await tx.inventoryMovement.createMany({
          data: results.map((outcome) => ({
            variantId: outcome.variantId,
            type: input.type,
            quantityChange: outcome.quantityChange,
            stockBefore: outcome.stockBefore,
            stockAfter: outcome.stockAfter,
            reference: input.reference || null,
            note: input.note || null,
            userId: session.id,
          })),
        });

        return results;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );

    return Response.json({ type: input.type, results: outcomes }, { status: 201 });
  } catch (err) {
    if (err instanceof InventoryError) {
      return apiError(err.status, err.code, err.message, err.details);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return apiError(409, "CONFLICT", "Stock changed at the same time. Please try again.");
    }
    console.error("[POST /api/admin/inventory/receive]", err);
    return apiError(500, "INTERNAL_ERROR", "Stock update failed. No changes were saved.");
  }
}
