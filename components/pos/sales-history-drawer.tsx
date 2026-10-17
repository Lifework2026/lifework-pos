"use client";

import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ReceiptPreviewDialog } from "@/components/pos/receipt-preview-dialog";
import { formatBaht, parseMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { paymentLabel } from "@/lib/payment-labels";
import type { OrderDetails } from "@/lib/pos-types";
import { cn } from "@/lib/utils";

interface SalesHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS: Record<string, { key: MessageKey; className: string }> = {
  COMPLETED: { key: "sales.statusCompleted", className: "bg-foreground text-background" },
  PARTIALLY_REFUNDED: { key: "sales.statusPartial", className: "border border-amber-600 text-amber-700" },
  REFUNDED: { key: "sales.statusRefunded", className: "border border-amber-600 text-amber-700" },
  VOIDED: { key: "sales.statusVoided", className: "border border-destructive text-destructive" },
};

/**
 * Today's bills in a slide-over on the right: receipt number, time, how it was paid, the net total and the status, with a
 * button that opens the receipt in the print preview. Closing it (Esc or X) hands the cursor back to the barcode field,
 * which the till page does when the window goes away.
 */
export function SalesHistoryDrawer({ open, onOpenChange }: SalesHistoryDrawerProps) {
  const { t, locale } = useI18n();
  const [orders, setOrders] = useState<OrderDetails[] | null>(null);
  const [scope, setScope] = useState<"OWN" | "ALL">("OWN");
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<OrderDetails | null>(null);

  // Loaded fresh every time the drawer opens, so a bill made a moment ago is there.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setFailed(false);
    setOrders(null);
    fetch("/api/orders/today", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("today");
        const body: { orders: OrderDetails[]; scope: "OWN" | "ALL" } = await res.json();
        setOrders(body.orders);
        setScope(body.scope);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [open]);

  const counted = (orders ?? []).filter((order) => order.status !== "VOIDED");
  const sum = counted.reduce((total, order) => total + parseMoney(order.totalAmount) - parseMoney(order.refundedAmount), 0);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
  const methods = (order: OrderDetails) => Array.from(new Set(order.payments.map((payment) => paymentLabel(payment.method, locale)))).join(" + ") || "—";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-0 right-0 left-auto flex h-dvh max-h-dvh w-[680px] max-w-[680px] translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-[680px]"
        >
          <header className="flex items-start justify-between gap-4 bg-foreground px-5 py-4 text-background">
            <div className="flex flex-col gap-1.5">
              <DialogTitle className="text-base font-extrabold tracking-[0.12em] uppercase">{t("history.title")}</DialogTitle>
              <DialogDescription className="text-xs text-background/70">{t("history.description")}</DialogDescription>
            </div>
            <DialogClose
              aria-label={t("common.close")}
              className="flex size-8 shrink-0 items-center justify-center rounded-[3px] border border-background/40 text-background transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="size-4" />
            </DialogClose>
          </header>

          <div className="flex items-center justify-between border-b px-5 py-2.5 text-xs">
            <span className="text-muted-foreground">{scope === "ALL" ? t("history.allCashiers") : t("history.ownOnly")}</span>
            {orders ? <span className="num font-bold">{t("history.summary", { count: counted.length, total: formatBaht(sum) })}</span> : null}
          </div>

          <div className="grid grid-cols-[1.5fr_56px_1fr_104px_104px_44px] gap-3 border-b bg-muted px-5 py-2 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
            <span>{t("history.receipt")}</span>
            <span>{t("history.time")}</span>
            <span>{t("history.payment")}</span>
            <span className="text-right">{t("history.total")}</span>
            <span>{t("history.status")}</span>
            <span />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {failed ? (
              <p role="alert" className="p-6 text-sm text-destructive">
                {t("history.error")}
              </p>
            ) : orders === null ? (
              <div className="flex flex-col gap-2 p-5" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-[3px] bg-muted" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">{t("history.empty")}</p>
            ) : (
              <ul>
                {orders.map((order) => {
                  const status = STATUS[order.status] ?? STATUS.COMPLETED;
                  return (
                    <li key={order.id} className="grid grid-cols-[1.5fr_56px_1fr_104px_104px_44px] items-center gap-3 border-b px-5 py-2.5 text-[13px]">
                      <span className="num truncate font-bold" title={order.receiptNo}>
                        {order.receiptNo}
                      </span>
                      <span className="num text-muted-foreground">{time(order.createdAt)}</span>
                      <span className="truncate" title={methods(order)}>
                        {methods(order)}
                      </span>
                      <span className={cn("num text-right font-extrabold", order.status === "VOIDED" && "text-muted-foreground line-through")}>
                        {formatBaht(parseMoney(order.totalAmount))}
                      </span>
                      <span className={cn("w-fit rounded-[2px] px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase", status.className)}>{t(status.key)}</span>
                      <button
                        type="button"
                        aria-label={`${t("history.print")} ${order.receiptNo}`}
                        title={t("history.print")}
                        onClick={() => setPreview(order)}
                        className="flex size-8 items-center justify-center rounded-[3px] border border-foreground/30 transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
                      >
                        <Printer className="size-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ReceiptPreviewDialog order={preview} open={preview !== null} onOpenChange={(next) => !next && setPreview(null)} title={t("history.print")} />
    </>
  );
}
