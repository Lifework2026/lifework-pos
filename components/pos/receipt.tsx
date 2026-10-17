"use client";

import { formatBaht, parseMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { paymentLabel, localizedName } from "@/lib/payment-labels";
import type { OrderDetails } from "@/lib/pos-types";


interface ReceiptProps {
  order: OrderDetails;
}

/**
 * Thermal receipt for 80mm paper. Screen styles keep it hidden unless it sits inside a
 * `.receipt-preview` container, so it can be previewed before printing. Printed in the active language.
 */
export function Receipt({ order }: ReceiptProps) {
  const { t, locale } = useI18n();
  const created = new Date(order.createdAt);
  const money = (value: string) => formatBaht(parseMoney(value));
  const discounts = [
    {
      label: order.promotionName ? t("receipt.promotion", { name: order.promotionName }) : t("receipt.promotionFallback"),
      value: order.promotionDiscount,
    },
    { label: t("receipt.memberDiscount"), value: order.memberDiscount },
    { label: t("receipt.discount"), value: order.manualDiscount },
    { label: t("checkout.pointsRedeemed"), value: order.pointsDiscount },
  ].filter((row) => parseMoney(row.value) > 0);
  const voided = order.status === "VOIDED";
  const refunded = parseMoney(order.refundedAmount) > 0;

  return (
    <div className="receipt-print" aria-hidden={voided ? undefined : true}>
      <div className="receipt-center">
        <p className="receipt-title">{order.store.name.toUpperCase()}</p>
        <p className="receipt-strong">{t("receipt.branch", { branch: order.store.branch })}</p>
        <p>{t("receipt.storeCode", { code: order.store.code })}</p>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-row">
        <span>{t("receipt.number")}</span>
        <span className="receipt-strong">{order.receiptNo}</span>
      </div>
      <div className="receipt-row">
        <span>{t("receipt.dateTime")}</span>
        <span>
          {created.toLocaleString(locale === "th" ? "th-TH-u-ca-gregory" : "en-GB", {
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
        <span>{t("receipt.staff")}</span>
        <span>{order.cashier.fullName}</span>
      </div>
      {order.member ? (
        <div className="receipt-row">
          <span>{t("receipt.member")}</span>
          <span>
            {order.member.name} ({order.member.phone})
          </span>
        </div>
      ) : null}

      {voided ? <p className="receipt-center receipt-strong receipt-flag">{t("receipt.voided")}</p> : null}
      {voided && order.voidReason ? <p className="receipt-center">{t("receipt.reason", { reason: order.voidReason })}</p> : null}

      <div className="receipt-divider" />

      {order.items.map((item) => (
        <div key={item.id} className="receipt-item">
          <p>
            {localizedName(locale, item.productName, item.productNameTh)}
            {item.isBag ? ` ${t("receipt.bag")}` : ""}
          </p>
          <p className="receipt-sub">{item.isBag ? item.sku : `${item.size} / ${item.color} · ${item.sku}`}</p>
          <div className="receipt-row">
            <span>
              {item.quantity} x {money(item.unitPrice)}
            </span>
            <span>{money(item.lineSubtotal)}</span>
          </div>
          {parseMoney(item.discountAmount) > 0 ? (
            <div className="receipt-row receipt-sub">
              <span>{t("receipt.discount")}</span>
              <span>-{money(item.discountAmount)}</span>
            </div>
          ) : null}
          {item.refundedQuantity > 0 ? (
            <div className="receipt-row receipt-sub">
              <span>{t("receipt.refundedOf", { qty: item.refundedQuantity, total: item.quantity })}</span>
              <span>-{money(item.refundedAmount)}</span>
            </div>
          ) : null}
        </div>
      ))}

      <div className="receipt-divider" />

      {discounts.length > 0 ? (
        <>
          <div className="receipt-row">
            <span>{t("receipt.itemsTotal")}</span>
            <span>{money(order.subtotal)}</span>
          </div>
          {discounts.map((row) => (
            <div key={row.label} className="receipt-row">
              <span>{row.label}</span>
              <span>-{money(row.value)}</span>
            </div>
          ))}
        </>
      ) : null}
      <div className="receipt-row">
        <span>{t("receipt.subtotalExVat")}</span>
        <span>{money(order.netAmount)}</span>
      </div>
      <div className="receipt-row">
        <span>{t("receipt.vat", { percent: order.vatPercent })}</span>
        <span>{money(order.vatAmount)}</span>
      </div>
      <div className="receipt-row receipt-total">
        <span>{t("receipt.grandTotal")}</span>
        <span>{money(order.totalAmount)}</span>
      </div>
      <p className="receipt-center receipt-sub">{t("receipt.vatIncluded")}</p>

      <div className="receipt-divider" />

      {order.payments.map((payment, index) => (
        <div key={`${payment.method}-${index}`}>
          <div className="receipt-row">
            <span>{paymentLabel(payment.method, locale)}</span>
            <span>{money(payment.amount)}</span>
          </div>
          {payment.reference ? <p className="receipt-sub">{t("receipt.ref", { ref: payment.reference })}</p> : null}
          {payment.edcRef?.transactionRef ? (
            <p className="receipt-sub">
              {t("receipt.cardRef", { ref: payment.edcRef.transactionRef })}
              {payment.edcRef.cardMask ? ` ${payment.edcRef.cardMask}` : ""}
            </p>
          ) : null}
          {payment.tendered ? (
            <div className="receipt-row receipt-sub">
              <span>{t("receipt.cashReceived")}</span>
              <span>{money(payment.tendered)}</span>
            </div>
          ) : null}
          {payment.changeGiven && parseMoney(payment.changeGiven) > 0 ? (
            <div className="receipt-row receipt-sub">
              <span>{t("receipt.change")}</span>
              <span>{money(payment.changeGiven)}</span>
            </div>
          ) : null}
        </div>
      ))}

      {refunded ? (
        <div className="receipt-row receipt-strong">
          <span>{t("receipt.totalRefunded")}</span>
          <span>{money(order.refundedAmount)}</span>
        </div>
      ) : null}

      {order.member && (order.member.pointsEarned > 0 || order.member.pointsRedeemed > 0) ? (
        <>
          <div className="receipt-divider" />
          <div className="receipt-row">
            <span>{t("receipt.pointsEarned")}</span>
            <span>{order.member.pointsEarned}</span>
          </div>
          <div className="receipt-row">
            <span>{t("receipt.pointsRedeemed")}</span>
            <span>{order.member.pointsRedeemed}</span>
          </div>
        </>
      ) : null}

      <div className="receipt-divider" />

      <div className="receipt-center">
        <p>{t("receipt.thanks", { store: order.store.name })}</p>
      </div>
    </div>
  );
}
