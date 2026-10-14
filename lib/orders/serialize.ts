import { Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/api";
import type { OrderDetails } from "@/lib/pos-types";

/** Shared order query shape: items, cashier and the linked card payment, if any. */
export const orderSelect = {
  id: true,
  receiptNo: true,
  status: true,
  subtotal: true,
  discountAmount: true,
  totalAmount: true,
  paymentMethod: true,
  amountReceived: true,
  changeAmount: true,
  createdAt: true,
  cashier: { select: { id: true, fullName: true } },
  items: {
    select: {
      id: true,
      variantId: true,
      productName: true,
      sku: true,
      barcode: true,
      size: true,
      color: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
    },
    orderBy: { id: "asc" as const },
  },
  edcPayment: {
    select: { mode: true, transactionRef: true, approvalCode: true, cardMask: true },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export function serializeOrder(order: OrderRecord): OrderDetails {
  return {
    id: order.id,
    receiptNo: order.receiptNo,
    status: order.status,
    subtotal: formatMoney(order.subtotal),
    discountAmount: formatMoney(order.discountAmount),
    totalAmount: formatMoney(order.totalAmount),
    paymentMethod: order.paymentMethod,
    amountReceived: order.amountReceived ? formatMoney(order.amountReceived) : null,
    changeAmount: order.changeAmount ? formatMoney(order.changeAmount) : null,
    createdAt: order.createdAt.toISOString(),
    cashier: { id: order.cashier.id, fullName: order.cashier.fullName },
    edcPayment: order.edcPayment
      ? {
          mode: order.edcPayment.mode,
          transactionRef: order.edcPayment.transactionRef,
          approvalCode: order.edcPayment.approvalCode,
          cardMask: order.edcPayment.cardMask,
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productName: item.productName,
      sku: item.sku,
      barcode: item.barcode,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPrice),
      lineTotal: formatMoney(item.lineTotal),
    })),
  };
}
