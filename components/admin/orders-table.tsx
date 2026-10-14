"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBangkokDateTime } from "@/lib/bangkok";
import { formatBaht, parseMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { localizedName, paymentLabel } from "@/lib/payment-labels";
import type { OrderDetails } from "@/lib/pos-types";
import { ReceiptPreviewDialog } from "@/components/pos/receipt-preview-dialog";
import { RefundDialog } from "@/components/admin/refund-dialog";
import { VoidDialog } from "@/components/admin/void-dialog";

const STATUS_STYLES: Record<string, { key: MessageKey; className: string }> = {
  COMPLETED: { key: "sales.statusCompleted", className: "bg-emerald-100 text-emerald-800" },
  PARTIALLY_REFUNDED: { key: "sales.statusPartial", className: "bg-amber-100 text-amber-800" },
  REFUNDED: { key: "sales.statusRefunded", className: "bg-slate-200 text-slate-800" },
  VOIDED: { key: "sales.statusVoided", className: "bg-red-100 text-red-800" },
};

interface OrdersTableProps {
  orders: OrderDetails[];
}

/** Sales log with detail, receipt preview, refund and void actions. */
export function OrdersTable({ orders }: OrdersTableProps) {
  const { t, locale } = useI18n();
  const [detail, setDetail] = useState<OrderDetails | null>(null);
  const [receipt, setReceipt] = useState<OrderDetails | null>(null);
  const [refunding, setRefunding] = useState<OrderDetails | null>(null);
  const [voiding, setVoiding] = useState<OrderDetails | null>(null);

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border bg-background px-4 py-16 text-center text-sm text-muted-foreground">{t("sales.noMatch")}</div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("sales.colReceipt")}</th>
              <th className="px-4 py-2 font-medium">{t("sales.colDateTime")}</th>
              <th className="px-4 py-2 font-medium">{t("sales.colStaff")}</th>
              <th className="px-4 py-2 font-medium">{t("sales.colPayment")}</th>
              <th className="px-4 py-2 font-medium">{t("sales.colStatus")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("sales.colTotal")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("sales.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const status = STATUS_STYLES[order.status];
              const canRefund = order.status !== "VOIDED" && order.items.some((i) => i.refundedQuantity < i.quantity);
              const canVoid = order.status !== "VOIDED" && parseMoney(order.refundedAmount) === 0;
              return (
                <tr key={order.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs font-medium">{order.receiptNo}</td>
                  <td className="px-4 py-2 tabular-nums">{formatBangkokDateTime(new Date(order.createdAt))}</td>
                  <td className="px-4 py-2">{order.cashier.fullName}</td>
                  <td className="px-4 py-2">
                    {order.payments.map((p) => paymentLabel(p.method, locale)).join(" + ")}
                    {order.member ? (
                      <span className="block text-xs text-muted-foreground">{t("sales.memberName", { name: order.member.name })}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status?.className ?? "bg-muted"}`}>
                      {status ? t(status.key) : order.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatBaht(parseMoney(order.totalAmount))}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setDetail(order)}>
                        {t("sales.view")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setReceipt(order)}>
                        {t("sales.receipt")}
                      </Button>
                      {canRefund ? (
                        <Button variant="outline" size="sm" onClick={() => setRefunding(order)}>
                          {t("sales.refund")}
                        </Button>
                      ) : null}
                      {canVoid ? (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setVoiding(order)}>
                          {t("sales.void")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{detail.receiptNo}</DialogTitle>
                <DialogDescription>
                  {formatBangkokDateTime(new Date(detail.createdAt))} · {t("sales.staffName", { name: detail.cashier.fullName })}
                  {detail.member ? ` · ${t("sales.memberName", { name: detail.member.name })}` : ""}
                </DialogDescription>
              </DialogHeader>

              {detail.status === "VOIDED" ? (
                <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                  {t("sales.voidedInfo", {
                    when: detail.voidedAt ? formatBangkokDateTime(new Date(detail.voidedAt)) : "",
                    reason: detail.voidReason ?? "",
                  })}
                </p>
              ) : null}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("sales.item")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("sales.qty")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("sales.unit")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("sales.discountCol")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("sales.netCol")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("sales.refundedCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">
                          <p className="font-medium">
                            {localizedName(locale, item.productName, item.productNameTh)}
                            {item.isBag ? ` ${t("receipt.bag")}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.isBag ? item.sku : `${item.size} · ${item.color} · `}
                            {item.isBag ? "" : <span className="font-mono">{item.sku}</span>}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBaht(parseMoney(item.unitPrice))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBaht(parseMoney(item.discountAmount))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBaht(parseMoney(item.netAmount))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {item.refundedQuantity > 0
                            ? `${item.refundedQuantity} · ${formatBaht(parseMoney(item.refundedAmount))}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <Detail label={t("checkout.subtotal")} value={formatBaht(parseMoney(detail.subtotal))} />
                <Detail label={t("receipt.promotionFallback")} value={`-${formatBaht(parseMoney(detail.promotionDiscount))}`} />
                <Detail label={t("checkout.memberDiscount")} value={`-${formatBaht(parseMoney(detail.memberDiscount))}`} />
                <Detail label={t("checkout.discount")} value={`-${formatBaht(parseMoney(detail.manualDiscount))}`} />
                <Detail label={t("checkout.pointsRedeemed")} value={`-${formatBaht(parseMoney(detail.pointsDiscount))}`} />
                <Detail label={t("dash.total")} value={formatBaht(parseMoney(detail.totalAmount))} strong />
                <Detail label={t("receipt.totalRefunded")} value={formatBaht(parseMoney(detail.refundedAmount))} />
                <Detail
                  label={t("sales.pointsEarnedRedeemed")}
                  value={detail.member ? `${detail.member.pointsEarned} / ${detail.member.pointsRedeemed}` : "—"}
                />
              </dl>

              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{t("sales.paymentsTitle")}</p>
                {detail.payments.map((payment, index) => (
                  <div key={index} className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <span>{paymentLabel(payment.method, locale)}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {payment.reference ? payment.reference : ""}
                      {payment.edcRef?.transactionRef
                        ? `${t("receipt.cardRef", { ref: payment.edcRef.transactionRef })} ${payment.edcRef.cardMask ?? ""}`
                        : ""}
                    </span>
                    <span className="tabular-nums">{formatBaht(parseMoney(payment.amount))}</span>
                  </div>
                ))}
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => setReceipt(detail)}>
                  {t("sales.receiptPreview")}
                </Button>
                <Button onClick={() => setDetail(null)}>{t("common.close")}</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ReceiptPreviewDialog order={receipt} open={receipt !== null} onOpenChange={(open) => !open && setReceipt(null)} />

      {refunding ? <RefundDialog order={refunding} open onOpenChange={(open) => !open && setRefunding(null)} /> : null}
      {voiding ? <VoidDialog order={voiding} open onOpenChange={(open) => !open && setVoiding(null)} /> : null}
    </>
  );
}

function Detail({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-base font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
