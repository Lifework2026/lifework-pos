"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBaht } from "@/lib/format";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import type { HeldBillSummary, ResumedBill } from "@/lib/held-bills";

interface HeldBillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The cart must be empty to resume, so one bill never overwrites another. */
  cartHasItems: boolean;
  onResumed: (bill: ResumedBill) => void;
  /** Called after the list changes, so the badge on the Held button stays accurate. */
  onCountChange: (count: number) => void;
}

export function HeldBillsDialog({ open, onOpenChange, cartHasItems, onResumed, onCountChange }: HeldBillsDialogProps) {
  const { t, locale } = useI18n();
  const [bills, setBills] = useState<HeldBillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await requestJson<{ bills: HeldBillSummary[] }>("/api/held-bills", { method: "GET" });
    if (result.ok) {
      setBills(result.data.bills);
      onCountChange(result.data.bills.length);
    } else {
      setError(t("hold.loadFailed"));
    }
    setLoading(false);
  }, [onCountChange, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function resume(bill: HeldBillSummary): Promise<void> {
    setBusyId(bill.id);
    setError(null);
    const result = await requestJson<ResumedBill>(`/api/held-bills/${bill.id}/resume`, { method: "POST" }, { retries: 0 });
    setBusyId(null);
    if (!result.ok) {
      setError(result.code === "NOT_FOUND" ? t("hold.alreadyGone") : t("hold.resumeFailed"));
      void load();
      return;
    }
    onResumed(result.data);
    onOpenChange(false);
  }

  async function discard(bill: HeldBillSummary): Promise<void> {
    if (!window.confirm(t("hold.confirmDiscard"))) return;
    setBusyId(bill.id);
    setError(null);
    await requestJson(`/api/held-bills/${bill.id}`, { method: "DELETE" }, { retries: 0 });
    setBusyId(null);
    await load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("hold.title")}</DialogTitle>
          <DialogDescription>{cartHasItems ? t("hold.cartNotEmpty") : t("hold.description")}</DialogDescription>
        </DialogHeader>

        {loading && bills.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
          </p>
        ) : bills.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("hold.none")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {bills.map((bill) => (
              <li key={bill.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{bill.label || t("hold.unnamed")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("pos.itemCount", { count: bill.itemCount })} · {formatBaht(Number(bill.total))} ·{" "}
                    {new Date(bill.createdAt).toLocaleTimeString(locale === "th" ? "th-TH" : "en-GB", {
                      timeZone: "Asia/Bangkok",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {bill.createdBy ? ` · ${bill.createdBy}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => resume(bill)} disabled={cartHasItems || busyId !== null}>
                    {busyId === bill.id ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("hold.resume")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => discard(bill)} disabled={busyId !== null}>
                    {t("hold.discard")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
