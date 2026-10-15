"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { paymentLabel } from "@/lib/payment-labels";
import type { ApiErrorBody, OrderDetails } from "@/lib/pos-types";

interface VoidDialogProps {
  order: OrderDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Voids a whole bill. Stock comes back, member points are reversed, and an audit entry is written. */
export function VoidDialog({ order, open, onOpenChange }: VoidDialogProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // A ref, not state, so two taps in the same frame cannot both submit.
  const submitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const restocked = order.items.reduce((sum, item) => sum + (item.quantity - item.refundedQuantity), 0);

  async function submit(): Promise<void> {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      if (!res.ok) {
        setError(body?.message ?? t("void.failed"));
        return;
      }
      toast.add({ title: t("void.done"), description: t("void.doneBody", { receipt: order.receiptNo }), type: "success" });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("void.title", { receipt: order.receiptNo })}</DialogTitle>
          <DialogDescription>{t("void.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t("void.restock", { count: restocked })}</li>
            <li>{t("void.points")}</li>
            <li>
              {t("void.payments", {
                amount: formatBaht(Number(order.totalAmount)),
                methods: order.payments.map((p) => paymentLabel(p.method, locale)).join(" + "),
              })}
            </li>
          </ul>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t("void.reason")}</span>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder={t("void.reasonPlaceholder")} />
          </label>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("void.keep")}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting || reason.trim().length < 3}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("void.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
