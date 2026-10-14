"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import type { ApiErrorBody, OrderDetails } from "@/lib/pos-types";
import { paymentLabel } from "@/lib/payment-labels";

interface VoidDialogProps {
  order: OrderDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Voids a whole bill. Stock comes back, member points are reversed, and an audit entry is written. */
export function VoidDialog({ order, open, onOpenChange }: VoidDialogProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restocked = order.items.reduce((sum, item) => sum + (item.quantity - item.refundedQuantity), 0);

  async function submit(): Promise<void> {
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
        setError(body?.message ?? "Void failed. Nothing was changed.");
        return;
      }
      toast.add({ title: "Bill voided", description: `${order.receiptNo} is voided and stock was restored.`, type: "success" });
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("Network error. Nothing was changed. Check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void bill {order.receiptNo}</DialogTitle>
          <DialogDescription>This cancels the whole sale. It cannot be undone.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{restocked} unit(s) go back into stock.</li>
            <li>Earned member points are reversed, and redeemed points are returned.</li>
            <li>
              Payments are not reversed automatically. Refund {formatBaht(Number(order.totalAmount))} by{" "}
              {order.payments.map((p) => paymentLabel(p.method)).join(" + ")} separately if money was taken.
            </li>
          </ul>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Reason (required)</span>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="e.g. Keyed in by mistake" />
          </label>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Keep sale
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting || reason.trim().length < 3}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Void bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
