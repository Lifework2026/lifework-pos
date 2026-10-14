"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Receipt } from "@/components/pos/receipt";
import { formatBangkokDateTime } from "@/lib/bangkok";
import { formatBaht, parseMoney } from "@/lib/format";
import { paymentLabel } from "@/lib/payment-labels";
import type { OrderDetails } from "@/lib/pos-types";

interface OrdersTableProps {
  orders: OrderDetails[];
}

/**
 * Sales list with a detail modal. The receipt is rendered once, below the table, and printed
 * on demand. That keeps a single #receipt-print element in the DOM for the print stylesheet.
 */
export function OrdersTable({ orders }: OrdersTableProps) {
  const [detail, setDetail] = useState<OrderDetails | null>(null);
  const [printTarget, setPrintTarget] = useState<OrderDetails | null>(null);

  // Print after the receipt for the chosen order has rendered.
  useEffect(() => {
    if (!printTarget) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintTarget(null);
    }, 50);
    return () => clearTimeout(timer);
  }, [printTarget]);

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border bg-background px-4 py-16 text-center text-sm text-muted-foreground">
        No sales match these filters.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Receipt</th>
              <th className="px-4 py-2 font-medium">Date & time</th>
              <th className="px-4 py-2 font-medium">Cashier</th>
              <th className="px-4 py-2 font-medium">Payment</th>
              <th className="px-4 py-2 text-right font-medium">Items</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
              return (
                <tr key={order.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs font-medium">{order.receiptNo}</td>
                  <td className="px-4 py-2 tabular-nums">{formatBangkokDateTime(new Date(order.createdAt))}</td>
                  <td className="px-4 py-2">{order.cashier.fullName}</td>
                  <td className="px-4 py-2">
                    {paymentLabel(order.paymentMethod)}
                    {order.edcPayment?.transactionRef ? (
                      <span className="block font-mono text-xs text-muted-foreground">
                        Ref {order.edcPayment.transactionRef}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{itemCount}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {formatBaht(parseMoney(order.totalAmount))}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDetail(order)}>
                        View
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPrintTarget(order)} aria-label={`Print ${order.receiptNo}`}>
                        <Printer className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{detail.receiptNo}</DialogTitle>
                <DialogDescription>
                  {formatBangkokDateTime(new Date(detail.createdAt))} · Cashier {detail.cashier.fullName}
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Unit</th>
                      <th className="px-3 py-2 text-right font-medium">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.size} · {item.color} · <span className="font-mono">{item.sku}</span>
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBaht(parseMoney(item.unitPrice))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBaht(parseMoney(item.lineTotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <Detail label="Subtotal" value={formatBaht(parseMoney(detail.subtotal))} />
                <Detail label="Discount" value={formatBaht(parseMoney(detail.discountAmount))} />
                <Detail label="Total paid" value={formatBaht(parseMoney(detail.totalAmount))} strong />
                <Detail label="Payment" value={paymentLabel(detail.paymentMethod)} />
                <Detail
                  label="Received"
                  value={detail.amountReceived ? formatBaht(parseMoney(detail.amountReceived)) : "—"}
                />
                <Detail label="Change given" value={detail.changeAmount ? formatBaht(parseMoney(detail.changeAmount)) : "—"} />
                {detail.edcPayment ? (
                  <>
                    <Detail label="Terminal ref" value={detail.edcPayment.transactionRef ?? "—"} mono />
                    <Detail label="Approval code" value={detail.edcPayment.approvalCode ?? "—"} mono />
                    <Detail label="Card" value={detail.edcPayment.cardMask ?? "—"} mono />
                  </>
                ) : null}
              </dl>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => setPrintTarget(detail)}>
                  <Printer className="size-4" /> Print receipt
                </Button>
                <Button onClick={() => setDetail(null)}>Close</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {printTarget ? <Receipt order={printTarget} /> : null}
    </>
  );
}

function Detail({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`${strong ? "text-base font-semibold" : ""} ${mono ? "font-mono text-xs" : ""} tabular-nums`}>
        {value}
      </dd>
    </div>
  );
}
