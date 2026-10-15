"use client";

import { useState } from "react";
import { useOnline } from "@/components/network-status";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";

interface ShiftActionsProps {
  shiftId: string;
  mode: "close" | "review";
}

/** Manager actions on a shift: close one that was left open, or sign off a closed one. */
export function ShiftActions({ shiftId, mode }: ShiftActionsProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    if (mode === "close") {
      const value = Number(counted);
      if (counted.trim() === "" || !Number.isFinite(value) || value < 0) {
        setError(t("shiftClose.errCount"));
        return;
      }
    }
    setBusy(true);
    const result = await requestJson<unknown>(
      mode === "close" ? `/api/admin/shifts/${shiftId}/close` : `/api/admin/shifts/${shiftId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "close" ? { countedCash: Number(counted), note: note.trim() || null } : { note: note.trim() || null }),
      },
      { retries: 0 },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? t("common.networkError"));
      return;
    }
    toast.add({ title: mode === "close" ? t("shifts.closedToast") : t("shifts.reviewedToast"), type: "success" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-4">
      <h2 className="font-semibold">{mode === "close" ? t("shifts.forceClose") : t("shifts.signOff")}</h2>
      <p className="text-sm text-muted-foreground">{mode === "close" ? t("shifts.forceCloseHint") : t("shifts.signOffHint")}</p>
      {mode === "close" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("shiftClose.counted")}</span>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} className="max-w-xs" />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{mode === "close" ? t("shiftClose.note") : t("shifts.reviewNote")}</span>
        <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void submit()} disabled={busy || !online} className="self-start">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {mode === "close" ? t("shifts.closeShift") : t("shifts.markReviewed")}
      </Button>
    </div>
  );
}
