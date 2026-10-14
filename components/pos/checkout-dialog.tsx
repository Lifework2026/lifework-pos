"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht, parseMoney } from "@/lib/format";
import type { ApiErrorBody, OrderDetails } from "@/lib/pos-types";
import type { EdcPaymentDto } from "@/lib/edc/types";
import { Receipt } from "@/components/pos/receipt";
import { useCartStore, type CartItem } from "@/store/useCartStore";

type PaymentMethodValue = "CASH" | "CARD" | "QR_PROMPTPAY" | "BANK_TRANSFER" | "OTHER";

const PAYMENT_OPTIONS: { value: PaymentMethodValue; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Credit / EDC" },
  { value: "QR_PROMPTPAY", label: "PromptPay QR" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

const BILL_DENOMINATIONS = [100, 500, 1000, 2000];
const EDC_POLL_INTERVAL_MS = 1_500;

/** Quick tender buttons: exact amount, plus the next few common bills that cover the total. */
function quickTenderOptions(total: number): number[] {
  const bills = BILL_DENOMINATIONS.filter((bill) => bill >= total).slice(0, 3);
  return Array.from(new Set([total, ...bills])).sort((a, b) => a - b);
}

const EDC_FAILURE_TITLES: Record<string, string> = {
  FAILED: "Card payment failed",
  CANCELLED: "Card payment cancelled",
  TIMED_OUT: "Card payment timed out",
};

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: (order: OrderDetails) => void;
}

export function CheckoutDialog({ open, onOpenChange, onCompleted }: CheckoutDialogProps) {
  const items = useCartStore((state) => state.items);
  const discount = useCartStore((state) => state.discount);
  const total = useCartStore((state) => state.getTotal());

  const [method, setMethod] = useState<PaymentMethodValue>("CASH");
  const [received, setReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetails | null>(null);

  const [edcPayment, setEdcPayment] = useState<EdcPaymentDto | null>(null);
  const [edcStarting, setEdcStarting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [manualApproval, setManualApproval] = useState("");

  // Guards against completing the same sale twice (e.g. a double click or a repeated poll result).
  const completingRef = useRef(false);

  // Start every checkout from a clean state.
  useEffect(() => {
    if (open) {
      setMethod("CASH");
      setReceived("");
      setSubmitting(false);
      setError(null);
      setOrder(null);
      setEdcPayment(null);
      setEdcStarting(false);
      setManualOpen(false);
      setManualRef("");
      setManualApproval("");
      completingRef.current = false;
    }
  }, [open]);

  const receivedNumber = Number(received);
  const isCash = method === "CASH";
  const isCard = method === "CARD";
  const change = isCash && Number.isFinite(receivedNumber) ? receivedNumber - total : 0;
  const tenderIsEnough = !isCash || (received !== "" && Number.isFinite(receivedNumber) && receivedNumber >= total);
  const quickTenders = useMemo(() => quickTenderOptions(total), [total]);

  /** Creates the order. For card sales, `edcPaymentId` is the approved terminal payment. */
  const submitSale = useCallback(
    async (edcPaymentId?: string): Promise<void> => {
      if (completingRef.current || items.length === 0) return;
      completingRef.current = true;
      setSubmitting(true);
      setError(null);

      const payload = {
        items: items.map((item: CartItem) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.price,
        })),
        paymentMethod: method,
        amountReceived: isCash ? receivedNumber : total,
        discountAmount: discount,
        ...(edcPaymentId ? { edcPaymentId } : {}),
      };

      try {
        const res = await fetch("/api/orders/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          completingRef.current = false;
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          const message = body?.message ?? "Checkout failed. Please try again.";
          setError(message);
          toast.add({ title: "Checkout failed", description: message, type: "error" });
          return;
        }

        const body = (await res.json()) as { order: OrderDetails };
        setOrder(body.order);
        toast.add({ title: "Sale complete", description: `Receipt ${body.order.receiptNo}`, type: "success" });
      } catch {
        completingRef.current = false;
        const message = "Network error. Check the connection; no sale was recorded.";
        setError(message);
        toast.add({ title: "Checkout failed", description: message, type: "error" });
      } finally {
        setSubmitting(false);
      }
    },
    [items, method, isCash, receivedNumber, total, discount],
  );

  // Poll the terminal while a card payment is pending. Each response is a new object,
  // which re-runs this effect for the next poll. A failed request re-runs it too.
  useEffect(() => {
    if (!open || !edcPayment || edcPayment.status !== "PENDING" || edcPayment.mode === "MANUAL") return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/edc/payments/${edcPayment.id}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
        if (!res.ok || !body.payment) {
          setError(body.message ?? "Could not check the card terminal. Retrying...");
          setEdcPayment((prev) => (prev ? { ...prev } : prev));
          return;
        }
        setError(null);
        setEdcPayment(body.payment);
      } catch {
        setEdcPayment((prev) => (prev ? { ...prev } : prev));
      }
    }, EDC_POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [open, edcPayment]);

  // Complete the sale automatically once the terminal reports success.
  useEffect(() => {
    if (edcPayment?.status === "SUCCESS" && !order) {
      void submitSale(edcPayment.id);
    }
  }, [edcPayment, order, submitSale]);

  async function startCardPayment(): Promise<void> {
    if (edcStarting) return;
    setEdcStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/edc/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: total }),
      });
      const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
      if (!res.ok || !body.payment) {
        setError(body?.message ?? "Could not reach the card terminal. Try again or enter the reference manually.");
        return;
      }
      setEdcPayment(body.payment);
    } catch {
      setError("Network error. Check the connection and try again.");
    } finally {
      setEdcStarting(false);
    }
  }

  async function cancelCardPayment(): Promise<void> {
    if (!edcPayment) return;
    setError(null);
    try {
      const res = await fetch(`/api/edc/payments/${edcPayment.id}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
      if (!res.ok || !body.payment) {
        setError(body?.message ?? "Could not cancel on the terminal. Check the terminal before retrying.");
        return;
      }
      setEdcPayment(body.payment);
    } catch {
      setError("Network error while cancelling. Check the terminal before retrying.");
    }
  }

  async function submitManualReference(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/edc/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: total,
          transactionRef: manualRef,
          approvalCode: manualApproval || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
      if (!res.ok || !body.payment) {
        setError(body?.message ?? "Could not record the reference.");
        return;
      }
      setManualOpen(false);
      setEdcPayment(body.payment);
    } catch {
      setError("Network error. Check the connection and try again.");
    }
  }

  function resetCardPayment(): void {
    setEdcPayment(null);
    setError(null);
  }

  function finish(): void {
    if (order) onCompleted(order);
    onOpenChange(false);
  }

  // A completed sale must always be finished through `finish`, so the cart is cleared.
  // A pending card payment must be cancelled or resolved first, so the terminal is not left charging.
  function handleOpenChange(next: boolean): void {
    if (submitting || edcStarting) return;
    if (!next && edcPayment?.status === "PENDING") return;
    if (!next && order) {
      finish();
      return;
    }
    onOpenChange(next);
  }

  const edcWaiting = isCard && edcPayment?.status === "PENDING";
  const edcApproved = isCard && edcPayment?.status === "SUCCESS";
  const edcFailed = isCard && edcPayment && edcPayment.status !== "PENDING" && edcPayment.status !== "SUCCESS";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {order ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-600" />
                Sale complete
              </DialogTitle>
              <DialogDescription>
                Receipt {order.receiptNo} · Total {formatBaht(parseMoney(order.totalAmount))}
                {isCash && order.changeAmount ? ` · Change ${formatBaht(parseMoney(order.changeAmount))}` : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" /> Print receipt
              </Button>
              <Button onClick={finish}>New sale</Button>
            </DialogFooter>
            <Receipt order={order} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Payment</DialogTitle>
              <DialogDescription>Total due {formatBaht(total)}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={method === option.value ? "default" : "outline"}
                  onClick={() => {
                    setMethod(option.value);
                    setError(null);
                    setEdcPayment(null);
                    setManualOpen(false);
                  }}
                  disabled={submitting || edcWaiting}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {isCash ? (
              <div className="flex flex-col gap-3">
                <label htmlFor="amount-received" className="text-sm font-medium">
                  Amount received
                </label>
                <Input
                  id="amount-received"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  autoFocus
                  value={received}
                  onChange={(event) => setReceived(event.target.value)}
                  className="h-12 text-right text-xl tabular-nums"
                  disabled={submitting}
                />
                <div className="flex flex-wrap gap-2">
                  {quickTenders.map((amount, index) => (
                    <Button
                      key={amount}
                      variant="secondary"
                      size="sm"
                      onClick={() => setReceived(String(amount))}
                      disabled={submitting}
                    >
                      {index === 0 && amount === total ? "Exact" : formatBaht(amount)}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted px-4 py-3">
                  <span className="text-sm text-muted-foreground">Change</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {tenderIsEnough && received !== "" ? formatBaht(change) : "—"}
                  </span>
                </div>
              </div>
            ) : null}

            {isCard ? (
              <div className="flex flex-col gap-3 rounded-md border p-4">
                {!edcPayment ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Send {formatBaht(total)} to the card terminal. The sale completes when the card is approved.
                    </p>
                    <Button size="lg" onClick={startCardPayment} disabled={edcStarting}>
                      {edcStarting ? <Loader2 className="size-4 animate-spin" /> : null}
                      Send to card terminal
                    </Button>
                  </>
                ) : null}

                {edcWaiting ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="text-base font-medium">Awaiting EDC card tap/insert...</p>
                    <p className="text-sm text-muted-foreground">{formatBaht(total)}</p>
                    {edcPayment?.terminalUnreachable ? (
                      <p className="text-sm text-amber-600">
                        The terminal is not responding. If the card was already processed, cancel here and enter the
                        slip reference below.
                      </p>
                    ) : null}
                    <Button variant="outline" onClick={cancelCardPayment}>
                      Cancel on terminal
                    </Button>
                  </div>
                ) : null}

                {edcApproved ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm font-medium text-emerald-700">
                    <Loader2 className="size-4 animate-spin" /> Card approved. Completing sale...
                  </div>
                ) : null}

                {edcFailed && edcPayment ? (
                  <div className="flex flex-col gap-3">
                    <p className="font-medium text-destructive">
                      {EDC_FAILURE_TITLES[edcPayment.status] ?? "Card payment not completed"}
                    </p>
                    {edcPayment.failureReason ? (
                      <p className="text-sm text-muted-foreground">{edcPayment.failureReason}</p>
                    ) : null}
                    <Button variant="outline" onClick={resetCardPayment}>
                      Try again
                    </Button>
                  </div>
                ) : null}

                {!edcApproved && !manualOpen ? (
                  <button
                    type="button"
                    className="self-start text-sm text-muted-foreground underline underline-offset-4"
                    onClick={() => setManualOpen(true)}
                  >
                    Terminal not working? Enter the slip reference manually
                  </button>
                ) : null}

                {manualOpen ? (
                  <div className="flex flex-col gap-3">
                    <label htmlFor="manual-ref" className="text-sm font-medium">
                      Terminal transaction reference
                    </label>
                    <Input
                      id="manual-ref"
                      value={manualRef}
                      onChange={(event) => setManualRef(event.target.value)}
                      placeholder="e.g. 0012345678"
                      className="font-mono"
                    />
                    <label htmlFor="manual-approval" className="text-sm font-medium">
                      Approval code (optional)
                    </label>
                    <Input
                      id="manual-approval"
                      value={manualApproval}
                      onChange={(event) => setManualApproval(event.target.value)}
                      className="font-mono"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setManualOpen(false)}>
                        Back
                      </Button>
                      <Button
                        onClick={submitManualReference}
                        disabled={manualRef.trim().length < 4}
                        className="flex-1"
                      >
                        Record card payment
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isCard ? (
              <p className="text-sm text-muted-foreground">
                Collect {formatBaht(total)} by {PAYMENT_OPTIONS.find((o) => o.value === method)?.label.toLowerCase()}.
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting || edcStarting || edcWaiting}
              >
                Cancel
              </Button>
              {!isCard ? (
                <Button
                  size="lg"
                  onClick={() => submitSale()}
                  disabled={submitting || !tenderIsEnough || items.length === 0}
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Confirm payment
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
