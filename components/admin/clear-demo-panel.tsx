"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eraser, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";
import { CLEAR_DEMO_PHRASE } from "@/lib/master-demo";

interface ClearDemoPanelProps {
  removable: { kind: "category" | "color"; code: string }[];
  kept: { kind: "category" | "color"; code: string; uses: number }[];
}

/**
 * Lists the legacy demo codes that the clear would remove, and the ones it keeps because something uses them. The
 * delete needs the phrase typed in, and the server repeats the usage check before it deletes anything.
 */
export function ClearDemoPanel({ removable, kept }: ClearDemoPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (kind: "category" | "color") => (kind === "category" ? t("master.kindCategory") : t("master.kindColor"));
  const removableList = removable.map((row) => `${row.code} (${label(row.kind)})`).join(", ");
  const keptList = kept.map((row) => `${row.code} (${row.uses})`).join(", ");

  async function clear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/master-data/clear-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: phrase }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; removedCategories?: number; removedColors?: number; message?: string } | null;
      if (res.ok && body?.ok) {
        toast.add({
          title: t("master.demoDone", { categories: body.removedCategories ?? 0, colors: body.removedColors ?? 0 }),
          type: "success",
        });
        setOpen(false);
        setPhrase("");
        router.refresh();
      } else {
        setError(body?.message ?? t("master.demoFailed"));
      }
    } catch {
      setError(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-amber-300/60 dark:border-amber-800/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eraser className="size-4" /> {t("master.demoTitle")}
        </CardTitle>
        <CardDescription>{t("master.demoBody")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {removable.length > 0 ? (
          <p>
            <span className="font-medium">{t("master.demoRemovable", { list: removableList })}</span>
          </p>
        ) : (
          <p className="text-muted-foreground">{t("master.demoNone")}</p>
        )}
        {kept.length > 0 ? <p className="text-muted-foreground">{t("master.demoKept", { list: keptList })}</p> : null}
        <div>
          <Button variant="outline" onClick={() => setOpen(true)} disabled={removable.length === 0}>
            <Eraser className="size-4" /> {t("master.demoButton")}
          </Button>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("master.demoConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("master.demoConfirmBody", { phrase: CLEAR_DEMO_PHRASE })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">{t("master.demoRemovable", { list: removableList })}</p>
          <Input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder={CLEAR_DEMO_PHRASE} aria-label={CLEAR_DEMO_PHRASE} className="font-mono" />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void clear()} disabled={busy || phrase !== CLEAR_DEMO_PHRASE}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("master.demoConfirmDo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
