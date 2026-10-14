"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { ApiErrorBody } from "@/lib/pos-types";
import type { EdcPaymentDto } from "@/lib/edc/types";

const POLL_INTERVAL_MS = 1_500;

const FAILURE_KEYS: Record<string, MessageKey> = {
  FAILED: "card.failed",
  CANCELLED: "card.cancelled",
  TIMED_OUT: "card.timedOut",
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
  const { t } = useI18n();
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
          setError(body?.message ?? t("card.notResponding"));
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
  }, [payment, t]);

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
        setError(body?.message ?? t("card.notResponding"));
        return;
      }
      setPayment(body.payment);
    } catch {
      setError(t("common.networkError"));
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
        setError(body?.message ?? t("card.notResponding"));
        return;
      }
      setPayment(body.payment);
    } catch {
      setError(t("common.networkError"));
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
        setError(body?.message ?? t("common.networkError"));
        return;
      }
      setManualOpen(false);
      setPayment(body.payment);
    } catch {
      setError(t("common.networkError"));
    }
  }

  if (approved && payment) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
        {t("card.approved", { amount: formatBaht(amount) })}
        {payment.transactionRef ? ` · ${t("card.ref", { ref: payment.transactionRef })}` : ""}
        {payment.cardMask ? ` · ${payment.cardMask}` : ""}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!payment ? (
        <Button size="lg" onClick={start} disabled={disabled || starting || amount <= 0} className="h-auto min-h-11 whitespace-normal py-2">
          {starting ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("card.send", { amount: formatBaht(amount) })}
        </Button>
      ) : null}

      {pending ? (
        <div className="flex flex-col items-center gap-2 rounded-md border p-4 text-center">
          <Loader2 className="size-7 animate-spin text-primary" />
          <p className="font-medium">{t("card.awaiting")}</p>
          <p className="text-sm text-muted-foreground">{formatBaht(amount)}</p>
          {payment.terminalUnreachable ? <p className="text-sm text-amber-600">{t("card.notResponding")}</p> : null}
          <Button variant="outline" onClick={cancel}>
            {t("card.cancelTerminal")}
          </Button>
        </div>
      ) : null}

      {payment && FAILURE_KEYS[payment.status] ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-destructive">{t(FAILURE_KEYS[payment.status] ?? "card.notCompleted")}</p>
          {payment.failureReason ? <p className="text-sm text-muted-foreground">{payment.failureReason}</p> : null}
          <Button variant="outline" onClick={() => setPayment(null)}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {!manualOpen && !approved ? (
        <button
          type="button"
          className="self-start text-sm text-muted-foreground underline underline-offset-4"
          onClick={() => setManualOpen(true)}
        >
          {t("card.manualToggle")}
        </button>
      ) : null}

      {manualOpen ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`manual-ref-${amount}`} className="text-sm font-medium">
            {t("card.terminalRef")}
          </label>
          <Input
            id={`manual-ref-${amount}`}
            value={manualRef}
            onChange={(event) => setManualRef(event.target.value)}
            placeholder="e.g. 0012345678"
            className="font-mono"
          />
          <label className="text-sm font-medium">{t("card.approvalCode")}</label>
          <Input value={manualApproval} onChange={(event) => setManualApproval(event.target.value)} className="font-mono" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              {t("card.back")}
            </Button>
            <Button className="flex-1" onClick={recordManual} disabled={manualRef.trim().length < 4}>
              {t("card.record")}
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
