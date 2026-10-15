"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, Loader2, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";

interface OpenShift {
  id: string;
  openedAt: string;
  openingFloat: string;
  orderCount: number;
  salesTotal: string;
}

interface ClosedShift {
  openedAt: string;
  closedAt: string;
  openingFloat: string;
  expectedCash: string;
  countedCash: string;
  variance: string;
  orderCount: number;
}

interface ShiftManagerProps {
  /** Tells the till whether it may sell. Selling is blocked until a shift is open. */
  onOpenChange: (open: boolean) => void;
  cartHasItems: boolean;
  /** Bumped by the till after each sale, so the receipt count refreshes. */
  salesVersion: number;
  /** Set when the cashier tried to sign out. Sign-out waits until the drawer is counted. */
  signOutRequested: boolean;
  onSignOutRequestHandled: () => void;
}

/**
 * Cash-drawer shift for the till. A cashier must declare the starting cash before selling, and counts the drawer
 * at the end. The count is blind: the expected amount is only shown after the shift is closed.
 */
export function ShiftManager({ onOpenChange, cartHasItems, salesVersion, signOutRequested, onSignOutRequestHandled }: ShiftManagerProps) {
  // One lock for open and close: a second tap while a request is in flight does nothing.
  const busyRef = useRef(false);
  const { t, locale } = useI18n();
  const router = useRouter();
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [floatInput, setFloatInput] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [result, setResult] = useState<ClosedShift | null>(null);

  const refresh = useCallback(async () => {
    const response = await requestJson<{ shift: OpenShift | null }>("/api/shifts/current", { method: "GET" });
    if (response.ok) {
      setShift(response.data.shift);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, salesVersion]);

  // Another tab may have closed the shift, so check again whenever the till comes back into view.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    onOpenChange(shift !== null);
  }, [shift, onOpenChange]);

  useEffect(() => {
    if (signOutRequested && loaded && !shift) onSignOutRequestHandled();
  }, [signOutRequested, loaded, shift, onSignOutRequestHandled]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  async function openShift(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await submitOpen();
    } finally {
      busyRef.current = false;
    }
  }

  async function submitOpen(): Promise<void> {
    setError(null);
    const value = Number(floatInput);
    if (floatInput.trim() === "" || !Number.isFinite(value) || value < 0) {
      setError(t("shiftOpen.errFloat"));
      return;
    }
    setBusy(true);
    const response = await requestJson<{ shift: OpenShift }>(
      "/api/shifts",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openingFloat: value, note: openNote.trim() || null }) },
      { retries: 0 },
    );
    setBusy(false);
    if (!response.ok) {
      if (response.code === "SHIFT_ALREADY_OPEN") {
        await refresh();
        return;
      }
      setError(response.message ?? t("common.networkError"));
      return;
    }
    setShift(response.data.shift);
    setFloatInput("");
    setOpenNote("");
    toast.add({ title: t("shiftOpen.toast"), type: "success" });
  }

  async function closeShift(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await submitClose();
    } finally {
      busyRef.current = false;
    }
  }

  async function submitClose(): Promise<void> {
    setError(null);
    const value = Number(counted);
    if (counted.trim() === "" || !Number.isFinite(value) || value < 0) {
      setError(t("shiftClose.errCount"));
      return;
    }
    setBusy(true);
    const response = await requestJson<{ shift: ClosedShift }>(
      "/api/shifts/current/close",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countedCash: value, note: closeNote.trim() || null }) },
      { retries: 0 },
    );
    setBusy(false);
    if (!response.ok) {
      if (response.code === "NOTE_REQUIRED") setError(t("shiftClose.errNote"));
      else if (response.code === "NO_OPEN_SHIFT") {
        setClosing(false);
        await refresh();
      } else setError(response.message ?? t("common.networkError"));
      return;
    }
    setClosing(false);
    setResult(response.data.shift);
    setShift(null);
    toast.add({ title: t("shifts.closedToast"), type: "success" });
    setCounted("");
    setCloseNote("");
  }

  async function signOut(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const variance = result ? Number(result.variance) : 0;

  return (
    <>
      {shift ? (
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs sm:inline-flex" title={t("shift.since", { time: time(shift.openedAt) })}>
            <Wallet className="size-3.5 text-emerald-600" />
            {t("shift.badge", { time: time(shift.openedAt), count: shift.orderCount })}
          </span>
          <Button variant="outline" size="sm" onClick={() => { setError(null); setClosing(true); }}>
            <Banknote className="size-4" />
            {t("shift.close")}
          </Button>
        </div>
      ) : null}

      {/* Sign-out is blocked until the drawer is counted. The modal cannot be dismissed except by going back to sales. */}
      <Dialog open={signOutRequested && shift !== null && !closing && result === null} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("signout.blockTitle")}</DialogTitle>
            <DialogDescription>{t("signout.blockBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={onSignOutRequestHandled}>
              {t("signout.backToSales")}
            </Button>
            <Button
              onClick={() => {
                onSignOutRequestHandled();
                setError(null);
                setClosing(true);
              }}
            >
              {t("signout.closeAndCount")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blocking gate: nothing can be sold until the starting cash is declared. */}
      <Dialog open={loaded && !shift && !result} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("shiftOpen.title")}</DialogTitle>
            <DialogDescription>{t("shiftOpen.desc")}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("shiftOpen.float")}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              autoFocus
              value={floatInput}
              onChange={(event) => setFloatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void openShift();
              }}
              className="h-11 text-lg tabular-nums"
              aria-label={t("shiftOpen.float")}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("shiftOpen.note")}</span>
            <Input value={openNote} onChange={(event) => setOpenNote(event.target.value)} maxLength={200} />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="size-4" />
              {t("common.signOut")}
            </Button>
            <Button onClick={() => void openShift()} disabled={busy} className="h-10">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("shiftOpen.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={(next) => !busy && setClosing(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("shiftClose.title")}</DialogTitle>
            <DialogDescription>{t("shiftClose.desc")}</DialogDescription>
          </DialogHeader>
          {shift ? (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p>{t("shiftClose.summary", { count: shift.orderCount, total: formatBaht(Number(shift.salesTotal)) })}</p>
              <p className="text-muted-foreground">{t("shiftClose.openedAt", { time: time(shift.openedAt), float: formatBaht(Number(shift.openingFloat)) })}</p>
            </div>
          ) : null}
          {cartHasItems ? <p className="text-sm text-amber-700">{t("shiftClose.cartWarning")}</p> : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("shiftClose.counted")}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              autoFocus
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
              className="h-11 text-lg tabular-nums"
              aria-label={t("shiftClose.counted")}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("shiftClose.note")}</span>
            <Input value={closeNote} onChange={(event) => setCloseNote(event.target.value)} maxLength={300} />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setClosing(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void closeShift()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("shiftClose.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={result !== null} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-emerald-600" />
                  {t("shiftResult.title")}
                </DialogTitle>
                <DialogDescription>{t("shiftResult.desc", { count: result.orderCount })}</DialogDescription>
              </DialogHeader>
              <div className="divide-y text-sm tabular-nums">
                <div className="flex justify-between py-1.5">
                  <span>{t("shifts.float")}</span>
                  <span>{formatBaht(Number(result.openingFloat))}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span>{t("shifts.expected")}</span>
                  <span>{formatBaht(Number(result.expectedCash))}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span>{t("shifts.counted")}</span>
                  <span>{formatBaht(Number(result.countedCash))}</span>
                </div>
                <div className={`flex justify-between py-1.5 font-semibold ${variance < 0 ? "text-red-700" : variance > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                  <span>{t("shifts.variance")}</span>
                  <span>
                    {variance > 0 ? "+" : ""}
                    {formatBaht(variance)}
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {variance === 0 ? t("shiftResult.balanced") : variance < 0 ? t("shiftResult.short") : t("shiftResult.over")}
              </p>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="ghost" onClick={() => void signOut()}>
                  <LogOut className="size-4" />
                  {t("common.signOut")}
                </Button>
                <Button onClick={() => setResult(null)}>{t("shiftResult.newShift")}</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
