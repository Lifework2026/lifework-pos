"use client";

import { useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useOnline } from "@/components/network-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { allocateRefund, bahtToSatang, refundShare } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n/client";
import { paymentLabel } from "@/lib/payment-labels";
import type { ApiErrorBody, OrderDetails } from "@/lib/pos-types";

interface RefundDialogProps {
  order: OrderDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ReturnSlice {
  method: string;
  amountSatang: number;
}

/**
 * Itemized refund. Money goes back through the same channels the customer paid with.
 * The amounts shown use the same rules as the server, so the figures match what gets recorded.
 */
export function RefundDialog({ order, open, onOpenChange }: RefundDialogProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const online = useOnline();
  // A ref, not state, so two taps in the same frame cannot both submit.
  const submitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const refundable = order.items.filter((item) => item.quantity - item.refundedQuantity > 0);

  const selection = useMemo(
    () =>
      refundable.map((item) => {
        const qty = Number(quantities[item.id] ?? 0);
        const valid = Number.isInteger(qty) && qty >= 0 && qty <= item.quantity - item.refundedQuantity;
        const amountSatang =
          valid && qty > 0
            ? refundShare(bahtToSatang(item.netAmount), item.quantity, item.refundedQuantity, item.refundedQuantity + qty)
            : 0;
        return { item, qty, valid, amountSatang };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refundable, quantities],
  );
  const totalSatang = selection.reduce((sum, row) => sum + row.amountSatang, 0);
  const anyInvalid = selection.some((row) => !row.valid);
  const hasSelection = selection.some((row) => row.qty > 0);

  // Split the refund across the original payment lines, in the order they were paid.
  const slices = useMemo<ReturnSlice[] | null>(() => {
    if (totalSatang <= 0) return [];
    try {
      const parts = allocateRefund(
        totalSatang,
        order.payments.map((payment) => ({
          key: payment.id,
          amountSatang: bahtToSatang(payment.amount),
          refundedSatang: bahtToSatang(payment.refundedAmount),
        })),
      );
      return parts.map((part) => {
        const payment = order.payments.find((p) => p.id === part.key);
        return { method: payment?.method ?? "OTHER", amountSatang: part.amountSatang };
      });
    } catch {
      return null;
    }
  }, [order.payments, totalSatang]);

  const channelsNeedingReference = Array.from(new Set((slices ?? []).map((s) => s.method).filter((m) => m !== "CASH")));
  const referencesOk = channelsNeedingReference.every((method) => (references[method] ?? "").trim().length >= 3);
  const canSubmit = online && hasSelection && !anyInvalid && slices !== null && reason.trim().length >= 3 && referencesOk && !submitting;

  async function submit(): Promise<void> {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const refs: Record<string, string> = {};
      for (const method of channelsNeedingReference) refs[method] = (references[method] ?? "").trim();

      const res = await fetch(`/api/admin/orders/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          references: refs,
          items: selection.filter((row) => row.qty > 0).map((row) => ({ orderItemId: row.item.id, quantity: row.qty })),
        }),
      });
      const body = (await res.json().catch(() => null)) as ({ refund?: { amount: string } } & ApiErrorBody) | null;
      if (!res.ok || !body?.refund) {
        setError(body?.message ?? t("refund.failed"));
        return;
      }
      toast.add({
        title: t("refund.recorded"),
        description: t("refund.recordedBody", { amount: formatBaht(Number(body.refund.amount)) }),
        type: "success",
      });
      onOpenChange(false);
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("refund.title")}</DialogTitle>
          <DialogDescription>{t("refund.desc", { receipt: order.receiptNo })}</DialogDescription>
        </DialogHeader>

        {refundable.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("refund.allDone")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="divide-y rounded-md border">
              {selection.map(({ item, qty, valid, amountSatang }) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">
                      {item.productName}
                      {item.isBag ? ` ${t("receipt.bag")}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku} · {t("refund.refundable", { left: item.quantity - item.refundedQuantity, total: item.quantity })} ·{" "}
                      {t("refund.netPaid", { amount: formatBaht(Number(item.netAmount)) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      max={item.quantity - item.refundedQuantity}
                      step={1}
                      value={quantities[item.id] ?? ""}
                      onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                      className={`h-9 w-20 text-right tabular-nums ${valid ? "" : "border-destructive"}`}
                      aria-label={t("refund.unitsFor", { sku: item.sku })}
                    />
                    <span className="w-24 text-right text-sm tabular-nums">{qty > 0 && valid ? formatBaht(amountSatang / 100) : "—"}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-base font-semibold">
              <span>{t("refund.total")}</span>
              <span className="tabular-nums">{formatBaht(totalSatang / 100)}</span>
            </div>

            {slices && slices.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                <p className="font-medium">{t("refund.returnedTo")}</p>
                {slices.map((slice, index) => (
                  <div key={`${slice.method}-${index}`} className="flex justify-between">
                    <span>{paymentLabel(slice.method, locale)}</span>
                    <span className="tabular-nums">{formatBaht(slice.amountSatang / 100)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {channelsNeedingReference.map((method) => (
              <label key={method} className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("refund.referenceFor", { method: paymentLabel(method, locale) })}</span>
                <Input
                  value={references[method] ?? ""}
                  onChange={(event) => setReferences((current) => ({ ...current, [method]: event.target.value }))}
                  maxLength={100}
                  disabled={submitting}
                />
              </label>
            ))}

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("refund.reason")}</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder={t("refund.reasonPlaceholder")} />
            </label>

            {slices === null ? (
              <p role="alert" className="text-sm text-destructive">
                {t("refund.tooLarge")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          {refundable.length > 0 ? (
            <Button onClick={submit} disabled={!canSubmit}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("refund.confirm", { amount: totalSatang > 0 ? formatBaht(totalSatang / 100) : "" })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
