"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBaht } from "@/lib/format";
import type { ApiErrorBody } from "@/lib/pos-types";
import type { EdcPaymentDto } from "@/lib/edc/types";

const POLL_INTERVAL_MS = 1_500;

const FAILURE_TITLES: Record<string, string> = {
  FAILED: "Card payment failed",
  CANCELLED: "Card payment cancelled",
  TIMED_OUT: "Card payment timed out",
};

export interface ApprovedCard {
  edcPaymentId: string;
  transactionRef: string | null;
  cardMask: string | null;
}

interface CardPaymentLineProps {
  amount: number;
  disabled: boolean;
  onApproved: (card: ApprovedCard) => void;
  onPendingChange: (pending: boolean) => void;
}

/**
 * One card tender on the bill. Sends the line amount to the terminal, shows the waiting
 * state, polls until the terminal answers, and reports the approved payment to the checkout.
 * Also offers the manual slip-reference fallback for a dead bridge.
 */
export function CardPaymentLine({ amount, disabled, onApproved, onPendingChange }: CardPaymentLineProps) {
  const [payment, setPayment] = useState<EdcPaymentDto | null>(null);
  const [starting, setStarting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [manualApproval, setManualApproval] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reportedRef = useRef(false);

  const pending = payment?.status === "PENDING";
  const approved = payment?.status === "SUCCESS";

  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);

  // Report approval once, whether it came from the terminal or from the manual slip reference.
  useEffect(() => {
    if (payment?.status === "SUCCESS" && !reportedRef.current) {
      reportedRef.current = true;
      onApproved({ edcPaymentId: payment.id, transactionRef: payment.transactionRef, cardMask: payment.cardMask });
    }
  }, [payment, onApproved]);

  // Poll the terminal while pending. Each response is a new object, which schedules the next poll.
  useEffect(() => {
    if (!payment || payment.status !== "PENDING" || payment.mode === "MANUAL") return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/edc/payments/${payment.id}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
        if (!res.ok || !body.payment) {
          setError(body?.message ?? "Could not check the card terminal. Retrying...");
          setPayment((prev) => (prev ? { ...prev } : prev));
          return;
        }
        setError(null);
        setPayment(body.payment);
      } catch {
        setPayment((prev) => (prev ? { ...prev } : prev));
      }
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [payment]);

  async function start(): Promise<void> {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/edc/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
      if (!res.ok || !body.payment) {
        setError(body?.message ?? "Could not reach the card terminal. Try again or enter the reference manually.");
        return;
      }
      setPayment(body.payment);
    } catch {
      setError("Network error. Check the connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!payment) return;
    setError(null);
    try {
      const res = await fetch(`/api/edc/payments/${payment.id}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
      if (!res.ok || !body.payment) {
        setError(body?.message ?? "Could not cancel on the terminal. Check the terminal before retrying.");
        return;
      }
      setPayment(body.payment);
    } catch {
      setError("Network error while cancelling. Check the terminal before retrying.");
    }
  }

  async function recordManual(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/edc/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, transactionRef: manualRef, approvalCode: manualApproval || null }),
      });
      const body = (await res.json().catch(() => null)) as { payment?: EdcPaymentDto } & ApiErrorBody;
      if (!res.ok || !body.payment) {
        setError(body?.message ?? "Could not record the reference.");
        return;
      }
      setManualOpen(false);
      setPayment(body.payment);
    } catch {
      setError("Network error. Check the connection and try again.");
    }
  }

  if (approved && payment) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
        Approved {formatBaht(amount)}
        {payment.transactionRef ? ` · Ref ${payment.transactionRef}` : ""}
        {payment.cardMask ? ` · ${payment.cardMask}` : ""}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!payment ? (
        <Button size="lg" onClick={start} disabled={disabled || starting || amount <= 0}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : null}
          Send {formatBaht(amount)} to card terminal
        </Button>
      ) : null}

      {pending ? (
        <div className="flex flex-col items-center gap-2 rounded-md border p-4 text-center">
          <Loader2 className="size-7 animate-spin text-primary" />
          <p className="font-medium">Awaiting EDC card tap/insert...</p>
          <p className="text-sm text-muted-foreground">{formatBaht(amount)}</p>
          {payment.terminalUnreachable ? (
            <p className="text-sm text-amber-600">
              The terminal is not responding. If the card was already processed, cancel here and enter the slip reference.
            </p>
          ) : null}
          <Button variant="outline" onClick={cancel}>
            Cancel on terminal
          </Button>
        </div>
      ) : null}

      {payment && (payment.status === "FAILED" || payment.status === "CANCELLED" || payment.status === "TIMED_OUT") ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-destructive">{FAILURE_TITLES[payment.status] ?? "Card payment not completed"}</p>
          {payment.failureReason ? <p className="text-sm text-muted-foreground">{payment.failureReason}</p> : null}
          <Button variant="outline" onClick={() => setPayment(null)}>
            Try again
          </Button>
        </div>
      ) : null}

      {!manualOpen && !approved ? (
        <button
          type="button"
          className="self-start text-sm text-muted-foreground underline underline-offset-4"
          onClick={() => setManualOpen(true)}
        >
          Terminal not working? Enter the slip reference manually
        </button>
      ) : null}

      {manualOpen ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`manual-ref-${amount}`} className="text-sm font-medium">
            Terminal transaction reference
          </label>
          <Input
            id={`manual-ref-${amount}`}
            value={manualRef}
            onChange={(event) => setManualRef(event.target.value)}
            placeholder="e.g. 0012345678"
            className="font-mono"
          />
          <label className="text-sm font-medium">Approval code (optional)</label>
          <Input value={manualApproval} onChange={(event) => setManualApproval(event.target.value)} className="font-mono" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              Back
            </Button>
            <Button className="flex-1" onClick={recordManual} disabled={manualRef.trim().length < 4}>
              Record card payment
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
