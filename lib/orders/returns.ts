import { OrderStatus, Prisma, type PaymentMethod } from "@prisma/client";
import { allocateRefund, PricingError, refundShare, satangToDecimal } from "@/lib/pricing";
import { OrderError } from "@/lib/orders/errors";
import { requireDrawerForCash, resolveCashShift } from "@/lib/shifts";
import { orderSelect, type OrderRecord } from "@/lib/orders/serialize";

/** Order fields the return rules need on top of the serialized shape. */
const returnSelect = { ...orderSelect, memberId: true, pointsReversed: true, shiftId: true } as const;
type OrderWithRefs = Prisma.OrderGetPayload<{ select: typeof returnSelect }>;

/**
 * Voids and itemized refunds. Each runs in one serializable transaction: stock is restored,
 * member points are adjusted, the order is updated, and an audit entry is written.
 */

export interface RefundItemInput {
  orderItemId: string;
  quantity: number;
}

export interface RefundInput {
  reason: string;
  items: RefundItemInput[];
  /** Reference per channel that returns money (required for every non-cash channel used). */
  references: Partial<Record<PaymentMethod, string>>;
}

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 20_000,
} as const;

function toSatang(value: Prisma.Decimal | number | string): number {
  return Math.round(new Prisma.Decimal(value).toNumber() * 100);
}

async function loadOrder(tx: Prisma.TransactionClient, orderId: string): Promise<OrderWithRefs> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: returnSelect });
  if (!order) throw new OrderError(404, "ORDER_NOT_FOUND", "Order not found.");
  return order;
}

/** Puts units back on the shelf and writes a ledger entry for each variant. */
async function restock(
  tx: Prisma.TransactionClient,
  lines: { variantId: string; sku: string; units: number }[],
  type: "RETURN" | "VOID",
  orderId: string,
  receiptNo: string,
  userId: string,
  reason: string,
): Promise<void> {
  for (const line of lines) {
    if (line.units <= 0) continue;
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: line.variantId },
      select: { stockQuantity: true },
    });
    await tx.productVariant.update({
      where: { id: line.variantId },
      data: { stockQuantity: { increment: line.units } },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId: line.variantId,
        type,
        quantityChange: line.units,
        stockBefore: variant.stockQuantity,
        stockAfter: variant.stockQuantity + line.units,
        reference: receiptNo,
        note: `${type === "VOID" ? "Void" : "Refund"}: ${reason}`,
        orderId,
        userId,
      },
    });
  }
}

/** Voids an order. Only orders with no refunds can be voided. Use itemized refunds otherwise. */
export function runVoid(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
  userId: string,
): Promise<OrderWithRefs> {
  return (async () => {
    const order = await loadOrder(tx, orderId);
    if (order.status === OrderStatus.VOIDED) {
      throw new OrderError(409, "ALREADY_VOIDED", "This order is already voided.");
    }
    if (toSatang(order.refundedAmount) > 0) {
      throw new OrderError(409, "HAS_REFUNDS", "This order has refunds. Refund the remaining items instead of voiding.");
    }

    // Cash handed back for a voided bill comes out of a cash drawer, so one must be open to record it.
    const voidCashSatang = order.payments.filter((p) => p.method === "CASH").reduce((sum, p) => sum + toSatang(p.amount), 0);
    const voidShiftId = await resolveCashShift(tx, order.shiftId, userId);
    requireDrawerForCash(voidShiftId, voidCashSatang);

    await restock(
      tx,
      order.items.map((item) => ({
        variantId: item.variantId,
        sku: item.sku,
        units: item.quantity - item.refundedQuantity,
      })),
      "VOID",
      order.id,
      order.receiptNo,
      userId,
      reason,
    );

    for (const item of order.items) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { refundedQuantity: item.quantity, refundedAmount: item.netAmount },
      });
    }

    let pointsChange = 0;
    if (order.memberId) {
      const member = await tx.member.findUniqueOrThrow({
        where: { id: order.memberId },
        select: { points: true },
      });
      const earnedToReverse = order.pointsEarned - order.pointsReversed;
      const newBalance = Math.max(0, member.points - earnedToReverse + order.pointsRedeemed);
      pointsChange = newBalance - member.points;
      await tx.member.update({ where: { id: order.memberId }, data: { points: newBalance } });
    }

    const now = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.VOIDED,
        voidReason: reason,
        voidedAt: now,
        voidedById: userId,
        voidShiftId,
        pointsReversed: order.pointsEarned,
        refundedAmount: order.totalAmount,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "ORDER_VOID",
        entityType: "Order",
        entityId: order.id,
        reason,
        userId,
        details: {
          receiptNo: order.receiptNo,
          total: order.totalAmount.toFixed(2),
          payments: order.payments.map((p) => ({
            method: p.method,
            amount: p.amount.toFixed(2),
            reference: p.reference,
            transactionRef: p.edcPayment?.transactionRef ?? null,
          })),
          pointsEarnedReversed: order.pointsEarned,
          pointsRedeemedRestored: order.pointsRedeemed,
          memberPointsChange: pointsChange,
        },
      },
    });

    return loadOrder(tx, order.id);
  })();
}

/**
 * Refunds selected units. Refund amounts are cumulative shares of each line's net, so
 * partial refunds add up to exactly what the line was paid.
 */
export function runRefund(
  tx: Prisma.TransactionClient,
  orderId: string,
  input: RefundInput,
  userId: string,
): Promise<{ order: OrderRecord; refundId: string; amount: string }> {
  return (async () => {
    const order = await loadOrder(tx, orderId);
    if (order.status === OrderStatus.VOIDED) {
      throw new OrderError(409, "ORDER_VOIDED", "A voided order cannot be refunded.");
    }
    if (input.items.length === 0) {
      throw new OrderError(400, "NOTHING_TO_REFUND", "Select at least one item to refund.");
    }

    // Merge selections per line and validate against what is still refundable.
    const requested = new Map<string, number>();
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new OrderError(400, "INVALID_QUANTITY", "Refund quantities must be whole numbers of at least 1.");
      }
      requested.set(item.orderItemId, (requested.get(item.orderItemId) ?? 0) + item.quantity);
    }

    const byId = new Map(order.items.map((item) => [item.id, item]));
    const plan = Array.from(requested.entries()).map(([orderItemId, quantity]) => {
      const item = byId.get(orderItemId);
      if (!item) throw new OrderError(400, "ITEM_NOT_ON_ORDER", "An item does not belong to this order.");
      const remaining = item.quantity - item.refundedQuantity;
      if (quantity > remaining) {
        throw new OrderError(409, "OVER_REFUND", `Only ${remaining} of ${item.sku} can still be refunded.`, {
          orderItemId,
          remaining,
        });
      }
      const fromQty = item.refundedQuantity;
      const toQty = fromQty + quantity;
      const amountSatang = refundShare(toSatang(item.netAmount), item.quantity, fromQty, toQty);
      return { item, quantity, fromQty, toQty, amountSatang };
    });

    const refundSatang = plan.reduce((sum, line) => sum + line.amountSatang, 0);
    if (refundSatang <= 0) {
      throw new OrderError(400, "NOTHING_TO_REFUND", "The selected items have no refundable amount.");
    }

    // Return the money to the channels the customer paid with, in the order they were paid.
    const paymentById = new Map(order.payments.map((payment) => [payment.id, payment]));
    let parts: { key: string; amountSatang: number }[];
    try {
      parts = allocateRefund(
        refundSatang,
        order.payments.map((payment) => ({
          key: payment.id,
          amountSatang: toSatang(payment.amount),
          refundedSatang: toSatang(payment.refundedAmount),
        })),
      );
    } catch (err) {
      if (err instanceof PricingError) throw new OrderError(409, err.code, err.message);
      throw err;
    }
    const referenceFor = (method: PaymentMethod): string | null => {
      if (method === "CASH") return null;
      const reference = (input.references[method] ?? "").trim();
      if (reference.length < 3) {
        throw new OrderError(400, "REFERENCE_REQUIRED", "Enter the reference for each refund channel that is not cash.", {
          method,
        });
      }
      return reference;
    };
    const refundLines = parts.map((part) => {
      const payment = paymentById.get(part.key);
      if (!payment) throw new OrderError(409, "PAYMENT_MISSING", "A payment on this order could not be found.");
      return { paymentId: payment.id, method: payment.method, amountSatang: part.amountSatang, reference: referenceFor(payment.method) };
    });

    // Cash paid back comes out of a cash drawer, so one must be open to record it.
    const refundCashSatang = refundLines.filter((line) => line.method === "CASH").reduce((sum, line) => sum + line.amountSatang, 0);
    const refundShiftId = await resolveCashShift(tx, order.shiftId, userId);
    requireDrawerForCash(refundShiftId, refundCashSatang);

    for (const line of refundLines) {
      const payment = paymentById.get(line.paymentId);
      if (!payment) continue;
      await tx.payment.update({
        where: { id: line.paymentId },
        data: { refundedAmount: satangToDecimal(toSatang(payment.refundedAmount) + line.amountSatang) },
      });
    }

    await restock(
      tx,
      plan.map((line) => ({ variantId: line.item.variantId, sku: line.item.sku, units: line.quantity })),
      "RETURN",
      order.id,
      order.receiptNo,
      userId,
      input.reason,
    );

    for (const line of plan) {
      await tx.orderItem.update({
        where: { id: line.item.id },
        data: {
          refundedQuantity: line.toQty,
          refundedAmount: satangToDecimal(toSatang(line.item.refundedAmount) + line.amountSatang),
        },
      });
    }

    // Points: earned points are reversed in step with the merchandise refunded.
    // Redeemed points are not returned on a partial refund.
    let pointsReversedNow = 0;
    if (order.memberId && order.pointsEarned > 0) {
      const merchandise = order.items.filter((item) => !item.isBag);
      const merchNetSatang = merchandise.reduce((sum, item) => sum + toSatang(item.netAmount), 0);
      const refundedMerchSatang = merchandise.reduce((sum, item) => {
        const plannedLine = plan.find((line) => line.item.id === item.id);
        const extra = plannedLine ? plannedLine.amountSatang : 0;
        return sum + toSatang(item.refundedAmount) + extra;
      }, 0);
      if (merchNetSatang > 0) {
        const target = Number((BigInt(order.pointsEarned) * BigInt(refundedMerchSatang)) / BigInt(merchNetSatang));
        const delta = Math.max(0, target - order.pointsReversed);
        if (delta > 0) {
          const member = await tx.member.findUniqueOrThrow({ where: { id: order.memberId }, select: { points: true } });
          pointsReversedNow = Math.min(delta, member.points);
          await tx.member.update({
            where: { id: order.memberId },
            data: { points: member.points - pointsReversedNow },
          });
        }
      }
    }

    const refundedTotal = toSatang(order.refundedAmount) + refundSatang;
    const fullyRefunded = order.items.every((item) => {
      const planned = plan.find((line) => line.item.id === item.id);
      const refundedQty = planned ? planned.toQty : item.refundedQuantity;
      return refundedQty >= item.quantity;
    });
    const status =
      fullyRefunded || refundedTotal >= toSatang(order.totalAmount)
        ? OrderStatus.REFUNDED
        : OrderStatus.PARTIALLY_REFUNDED;

    await tx.order.update({
      where: { id: order.id },
      data: {
        status,
        refundedAmount: satangToDecimal(refundedTotal),
        pointsReversed: order.pointsReversed + pointsReversedNow,
      },
    });

    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        amount: satangToDecimal(refundSatang),
        reason: input.reason,
        createdById: userId,
        shiftId: refundShiftId,
        items: {
          create: plan.map((line) => ({
            orderItemId: line.item.id,
            quantity: line.quantity,
            amount: satangToDecimal(line.amountSatang),
          })),
        },
        lines: {
          create: refundLines.map((line) => ({
            paymentId: line.paymentId,
            method: line.method,
            amount: satangToDecimal(line.amountSatang),
            reference: line.reference,
          })),
        },
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        action: "ORDER_REFUND",
        entityType: "Order",
        entityId: order.id,
        reason: input.reason,
        userId,
        details: {
          receiptNo: order.receiptNo,
          refundId: refund.id,
          amount: satangToDecimal(refundSatang),
          lines: refundLines.map((line) => ({ method: line.method, amount: satangToDecimal(line.amountSatang), reference: line.reference })),
          items: plan.map((line) => ({ sku: line.item.sku, quantity: line.quantity, amount: satangToDecimal(line.amountSatang) })),
          pointsReversed: pointsReversedNow,
        },
      },
    });

    const updated = await loadOrder(tx, order.id);
    return { order: updated, refundId: refund.id, amount: satangToDecimal(refundSatang) };
  })();
}

export { TRANSACTION_OPTIONS };
