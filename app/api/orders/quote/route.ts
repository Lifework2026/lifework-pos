import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentSession } from "@/lib/auth/server";
import { satangToDecimal } from "@/lib/pricing";
import { priceBasket, type BasketInput } from "@/lib/orders/context";
import { OrderError } from "@/lib/orders/errors";
import { quoteSchema, type QuoteInput } from "@/lib/orders/schemas";
import { Prisma } from "@prisma/client";

/** Connection-level Prisma errors: the database cannot be reached right now. */
function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(err.code);
}

export const dynamic = "force-dynamic";

function toBasketInput(input: QuoteInput): BasketInput {
  return {
    items: input.items,
    bag: input.bag,
    memberId: input.memberId ?? null,
    promotionId: input.promotionId ?? null,
    redeemPoints: input.redeemPoints,
    manualDiscount: input.manualDiscount,
  };
}

/**
 * POST /api/orders/quote
 *
 * Prices a basket without charging it. The POS shows this breakdown before payment, and
 * checkout prices the same basket again on the server, so the figures match.
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

  const parsed = quoteSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Basket is invalid.");
  }

  try {
    const basket = await priceBasket(prisma, toBasketInput(parsed.data));
    const { pricing } = basket;
    const resultByKey = new Map(pricing.lines.map((line) => [line.key, line]));

    return Response.json({
      totals: {
        subtotal: satangToDecimal(pricing.subtotal),
        promotionDiscount: satangToDecimal(pricing.promotionDiscount),
        memberDiscount: satangToDecimal(pricing.memberDiscount),
        manualDiscount: satangToDecimal(pricing.manualDiscount),
        pointsDiscount: satangToDecimal(pricing.pointsDiscount),
        discount: satangToDecimal(pricing.discount),
        total: satangToDecimal(pricing.total),
      },
      promotionName: pricing.promotionName,
      pointsEarned: pricing.pointsEarned,
      pointsRedeemed: pricing.pointsRedeemed,
      member: basket.member,
      lines: basket.lines.map((line) => {
        const result = resultByKey.get(line.key);
        return {
          key: line.key,
          variantId: line.variantId,
          productName: line.productName,
          sku: line.sku,
          size: line.size,
          color: line.color,
          isBag: line.isBag,
          quantity: line.quantity,
          unitPrice: satangToDecimal(line.unitPriceSatang),
          subtotal: satangToDecimal(result?.subtotal ?? 0),
          discount: satangToDecimal(result?.discount ?? 0),
          net: satangToDecimal(result?.net ?? 0),
        };
      }),
    });
  } catch (err) {
    if (err instanceof OrderError) {
      return apiError(err.status, err.code, err.message, err.details);
    }
    if (isDatabaseUnavailable(err)) {
      console.error("[POST /api/orders/quote] database unavailable", err);
      return apiError(503, "DATABASE_UNAVAILABLE", "The database is not responding. Try again in a moment.");
    }
    console.error("[POST /api/orders/quote]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not price the basket. Try again.");
  }
}
