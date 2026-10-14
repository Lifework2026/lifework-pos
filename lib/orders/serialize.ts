import { Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/api";
import { STORE } from "@/lib/store-config";
import type { OrderDetails } from "@/lib/pos-types";

/** Query shape shared by checkout, reprints, the sales log and returns. */
export const orderSelect = {
  id: true,
  receiptNo: true,
  status: true,
  bagType: true,
  subtotal: true,
  promotionDiscount: true,
  memberDiscount: true,
  manualDiscount: true,
  pointsDiscount: true,
  totalAmount: true,
  refundedAmount: true,
  pointsRedeemed: true,
  pointsEarned: true,
  voidReason: true,
  voidedAt: true,
  createdAt: true,
  cashier: { select: { id: true, fullName: true } },
  member: { select: { name: true, phone: true } },
  promotion: { select: { name: true } },
  items: {
    select: {
      id: true,
      variantId: true,
      productName: true,
      productNameTh: true,
      sku: true,
      barcode: true,
      size: true,
      color: true,
      isBag: true,
      quantity: true,
      refundedQuantity: true,
      unitPrice: true,
      lineSubtotal: true,
      discountAmount: true,
      netAmount: true,
      refundedAmount: true,
    },
    orderBy: { id: "asc" as const },
  },
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      refundedAmount: true,
      tendered: true,
      changeGiven: true,
      reference: true,
      edcPayment: { select: { transactionRef: true, approvalCode: true, cardMask: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export function serializeOrder(order: OrderRecord): OrderDetails {
  return {
    id: order.id,
    receiptNo: order.receiptNo,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    store: { name: STORE.name, branch: STORE.branch, code: STORE.code },
    cashier: { id: order.cashier.id, fullName: order.cashier.fullName },
    member: order.member
      ? {
          name: order.member.name,
          phone: order.member.phone,
          pointsEarned: order.pointsEarned,
          pointsRedeemed: order.pointsRedeemed,
        }
      : null,
    promotionName: order.promotion?.name ?? null,
    bagType: order.bagType,
    subtotal: formatMoney(order.subtotal),
    promotionDiscount: formatMoney(order.promotionDiscount),
    memberDiscount: formatMoney(order.memberDiscount),
    manualDiscount: formatMoney(order.manualDiscount),
    pointsDiscount: formatMoney(order.pointsDiscount),
    totalAmount: formatMoney(order.totalAmount),
    refundedAmount: formatMoney(order.refundedAmount),
    voidReason: order.voidReason,
    voidedAt: order.voidedAt?.toISOString() ?? null,
    payments: order.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: formatMoney(payment.amount),
      refundedAmount: formatMoney(payment.refundedAmount),
      tendered: payment.tendered ? formatMoney(payment.tendered) : null,
      changeGiven: payment.changeGiven ? formatMoney(payment.changeGiven) : null,
      reference: payment.reference,
      edcRef: payment.edcPayment
        ? {
            transactionRef: payment.edcPayment.transactionRef,
            approvalCode: payment.edcPayment.approvalCode,
            cardMask: payment.edcPayment.cardMask,
          }
        : null,
    })),
    items: order.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productName: item.productName,
      productNameTh: item.productNameTh,
      sku: item.sku,
      barcode: item.barcode,
      size: item.size,
      color: item.color,
      isBag: item.isBag,
      quantity: item.quantity,
      refundedQuantity: item.refundedQuantity,
      unitPrice: formatMoney(item.unitPrice),
      lineSubtotal: formatMoney(item.lineSubtotal),
      discountAmount: formatMoney(item.discountAmount),
      netAmount: formatMoney(item.netAmount),
      refundedAmount: formatMoney(item.refundedAmount),
    })),
  };
}
