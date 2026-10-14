"use client";

import { formatBaht, parseMoney } from "@/lib/format";
import type { OrderDetails } from "@/lib/pos-types";

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  QR_PROMPTPAY: "PromptPay QR",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

interface ReceiptProps {
  order: OrderDetails;
}

/**
 * Receipt laid out for 80mm thermal paper. It is hidden on screen and only
 * shown by the @media print rules in app/globals.css.
 */
export function Receipt({ order }: ReceiptProps) {
  const createdAt = new Date(order.createdAt);
  const isCash = order.paymentMethod === "CASH";

  return (
    <div id="receipt-print" className="receipt-print" aria-hidden>
      <div className="receipt-center">
        <p className="receipt-title">LIFEWORK</p>
        <p>Fashion Retail</p>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-row">
        <span>Receipt</span>
        <span>{order.receiptNo}</span>
      </div>
      <div className="receipt-row">
        <span>Date</span>
        <span>
          {createdAt.toLocaleString("th-TH", {
            timeZone: "Asia/Bangkok",
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </div>
      <div className="receipt-row">
        <span>Cashier</span>
        <span>{order.cashier.fullName}</span>
      </div>

      <div className="receipt-divider" />

      {order.items.map((item) => (
        <div key={item.id} className="receipt-item">
          <p>{item.productName}</p>
          <p className="receipt-sub">
            {item.size} / {item.color} · {item.sku}
          </p>
          <div className="receipt-row">
            <span>
              {item.quantity} x {formatBaht(parseMoney(item.unitPrice))}
            </span>
            <span>{formatBaht(parseMoney(item.lineTotal))}</span>
          </div>
        </div>
      ))}

      <div className="receipt-divider" />

      <div className="receipt-row">
        <span>Subtotal</span>
        <span>{formatBaht(parseMoney(order.subtotal))}</span>
      </div>
      {parseMoney(order.discountAmount) > 0 ? (
        <div className="receipt-row">
          <span>Discount</span>
          <span>-{formatBaht(parseMoney(order.discountAmount))}</span>
        </div>
      ) : null}
      <div className="receipt-row receipt-total">
        <span>TOTAL</span>
        <span>{formatBaht(parseMoney(order.totalAmount))}</span>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-row">
        <span>Payment</span>
        <span>{PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
      </div>
      {isCash && order.amountReceived ? (
        <div className="receipt-row">
          <span>Received</span>
          <span>{formatBaht(parseMoney(order.amountReceived))}</span>
        </div>
      ) : null}
      {isCash && order.changeAmount ? (
        <div className="receipt-row">
          <span>Change</span>
          <span>{formatBaht(parseMoney(order.changeAmount))}</span>
        </div>
      ) : null}

      <div className="receipt-divider" />

      <div className="receipt-center">
        <p>Thank you for shopping with us</p>
      </div>
    </div>
  );
}
