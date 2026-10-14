"use client";

import { formatBaht, parseMoney } from "@/lib/format";
import { paymentLabel } from "@/lib/payment-labels";
import type { OrderDetails } from "@/lib/pos-types";

const RECEIPT_ID = "receipt-print";

interface ReceiptProps {
  order: OrderDetails;
}

/**
 * Thermal receipt for 80mm paper. Screen styles keep it hidden unless it sits inside a
 * `.receipt-preview` container, so it can be previewed before printing.
 */
export function Receipt({ order }: ReceiptProps) {
  const created = new Date(order.createdAt);
  const money = (value: string) => formatBaht(parseMoney(value));
  const discounts = [
    { label: order.promotionName ? `Promotion: ${order.promotionName}` : "Promotion", value: order.promotionDiscount },
    { label: "Member discount", value: order.memberDiscount },
    { label: "Discount", value: order.manualDiscount },
    { label: "Points redeemed", value: order.pointsDiscount },
  ].filter((row) => parseMoney(row.value) > 0);
  const voided = order.status === "VOIDED";
  const refunded = parseMoney(order.refundedAmount) > 0;

  return (
    <div id={RECEIPT_ID} className="receipt-print" aria-hidden={voided ? undefined : true}>
      <div className="receipt-center">
        <p className="receipt-title">{order.store.name.toUpperCase()}</p>
        <p className="receipt-strong">Branch: {order.store.branch}</p>
        <p>Store code: {order.store.code}</p>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-row">
        <span>Receipt No.</span>
        <span className="receipt-strong">{order.receiptNo}</span>
      </div>
      <div className="receipt-row">
        <span>Date / time</span>
        <span>
          {created.toLocaleString("en-GB", {
            timeZone: "Asia/Bangkok",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="receipt-row">
        <span>Staff</span>
        <span>{order.cashier.fullName}</span>
      </div>
      {order.member ? (
        <div className="receipt-row">
          <span>Member</span>
          <span>
            {order.member.name} ({order.member.phone})
          </span>
        </div>
      ) : null}

      {voided ? <p className="receipt-center receipt-strong receipt-flag">*** VOIDED ***</p> : null}
      {voided && order.voidReason ? <p className="receipt-center">Reason: {order.voidReason}</p> : null}

      <div className="receipt-divider" />

      {order.items.map((item) => (
        <div key={item.id} className="receipt-item">
          <p>
            {item.productName}
            {item.isBag ? " (bag)" : ""}
          </p>
          <p className="receipt-sub">
            {item.isBag ? item.sku : `${item.size} / ${item.color} · ${item.sku}`}
          </p>
          <div className="receipt-row">
            <span>
              {item.quantity} x {money(item.unitPrice)}
            </span>
            <span>{money(item.lineSubtotal)}</span>
          </div>
          {parseMoney(item.discountAmount) > 0 ? (
            <div className="receipt-row receipt-sub">
              <span>Discount</span>
              <span>-{money(item.discountAmount)}</span>
            </div>
          ) : null}
          {item.refundedQuantity > 0 ? (
            <div className="receipt-row receipt-sub">
              <span>Refunded {item.refundedQuantity} of {item.quantity}</span>
              <span>-{money(item.refundedAmount)}</span>
            </div>
          ) : null}
        </div>
      ))}

      <div className="receipt-divider" />

      <div className="receipt-row">
        <span>Subtotal</span>
        <span>{money(order.subtotal)}</span>
      </div>
      {discounts.map((row) => (
        <div key={row.label} className="receipt-row">
          <span>{row.label}</span>
          <span>-{money(row.value)}</span>
        </div>
      ))}
      <div className="receipt-row receipt-total">
        <span>TOTAL</span>
        <span>{money(order.totalAmount)}</span>
      </div>

      <div className="receipt-divider" />

      {order.payments.map((payment, index) => (
        <div key={`${payment.method}-${index}`}>
          <div className="receipt-row">
            <span>{paymentLabel(payment.method)}</span>
            <span>{money(payment.amount)}</span>
          </div>
          {payment.reference ? <p className="receipt-sub">Ref: {payment.reference}</p> : null}
          {payment.edcRef?.transactionRef ? (
            <p className="receipt-sub">
              Card ref: {payment.edcRef.transactionRef}
              {payment.edcRef.cardMask ? ` ${payment.edcRef.cardMask}` : ""}
            </p>
          ) : null}
          {payment.tendered ? (
            <div className="receipt-row receipt-sub">
              <span>Cash received</span>
              <span>{money(payment.tendered)}</span>
            </div>
          ) : null}
          {payment.changeGiven && parseMoney(payment.changeGiven) > 0 ? (
            <div className="receipt-row receipt-sub">
              <span>Change</span>
              <span>{money(payment.changeGiven)}</span>
            </div>
          ) : null}
        </div>
      ))}

      {refunded ? (
        <div className="receipt-row receipt-strong">
          <span>Total refunded</span>
          <span>{money(order.refundedAmount)}</span>
        </div>
      ) : null}

      {order.member && (order.member.pointsEarned > 0 || order.member.pointsRedeemed > 0) ? (
        <>
          <div className="receipt-divider" />
          <div className="receipt-row">
            <span>Points earned</span>
            <span>{order.member.pointsEarned}</span>
          </div>
          <div className="receipt-row">
            <span>Points redeemed</span>
            <span>{order.member.pointsRedeemed}</span>
          </div>
        </>
      ) : null}

      <div className="receipt-divider" />

      <div className="receipt-center">
        <p>Thank you for shopping at {order.store.name}</p>
      </div>
    </div>
  );
}
