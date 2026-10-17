import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/api-helpers";
import type { HeldPayload, ResumedBill, ResumedItem, ResumeWarning } from "@/lib/held-bills";
import { variantImageUrl } from "@/lib/catalog/variant-image";
import { FREE_BAG_CART_STOCK, isFreeBag } from "@/lib/catalog/free-bags";

export const dynamic = "force-dynamic";

/**
 * POST /api/held-bills/[id]/resume
 *
 * Takes a parked bill off the shelf and returns its items with today's prices and stock. Items that
 * are no longer sold are dropped, quantities are capped at stock, and every change is reported as a
 * warning. The bill is removed in the same step, so two tills cannot resume it twice.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const result = await prisma.$transaction(async (tx) => {
    const bill = await tx.heldBill.findUnique({ where: { id: params.id } });
    if (!bill) return null;

    // Claim it. Only one request can delete the row, so only one can resume it.
    const claimed = await tx.heldBill.deleteMany({ where: { id: bill.id } });
    if (claimed.count !== 1) return null;

    const payload = bill.payload as unknown as HeldPayload;
    const variants = await tx.productVariant.findMany({
      where: { id: { in: payload.items.map((item) => item.variantId) } },
      select: {
        id: true,
        sku: true,
        barcode: true,
        size: true,
        color: true,
        colorId: true,
        price: true,
        stockQuantity: true,
        isActive: true,
        product: { select: { name: true, nameTh: true, imageUrl: true, colorImages: { select: { colorId: true, imageUrl: true } }, isActive: true } },
      },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));

    const items: ResumedItem[] = [];
    const warnings: ResumeWarning[] = [];
    for (const held of payload.items) {
      const variant = byId.get(held.variantId);
      if (!variant) {
        warnings.push({ kind: "REMOVED", sku: held.variantId });
        continue;
      }
      const counted = !isFreeBag(variant.sku);
      if (!variant.isActive || !variant.product.isActive || (counted && variant.stockQuantity <= 0)) {
        warnings.push({ kind: "REMOVED", sku: variant.sku });
        continue;
      }
      const quantity = counted ? Math.min(held.quantity, variant.stockQuantity) : held.quantity;
      if (quantity < held.quantity) warnings.push({ kind: "REDUCED", sku: variant.sku, from: held.quantity, to: quantity });

      const price = Number(variant.price);
      if (Math.round(price * 100) !== Math.round(held.unitPrice * 100)) {
        warnings.push({ kind: "PRICE_CHANGED", sku: variant.sku, from: held.unitPrice, to: price });
      }
      items.push({
        variantId: variant.id,
        name: variant.product.name,
        nameTh: variant.product.nameTh,
        imageUrl: variantImageUrl(variant.product, variant.colorId),
        size: variant.size,
        color: variant.color,
        sku: variant.sku,
        barcode: variant.barcode,
        price,
        stockQuantity: counted ? variant.stockQuantity : FREE_BAG_CART_STOCK,
        quantity,
      });
    }

    const resumed: ResumedBill = { items, discount: payload.discount, warnings };
    return resumed;
  });

  if (!result) return apiError(404, "NOT_FOUND", "That held bill was already resumed or discarded.");
  return Response.json(result);
}
