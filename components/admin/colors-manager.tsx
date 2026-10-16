"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { ActionBar } from "@/components/admin/action-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { CODE_RULE_MESSAGE } from "@/lib/master-codes";

interface ColorRow {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
  sortOrder: number;
  variantCount: number;
}

interface Draft {
  id: string;
  code: string;
  name: string;
  nameTh: string;
  sortOrder: string;
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Colour master data. Every colour has a unique code (for example 00) that spreadsheets use, and a name that
 * the till and receipts show. Renaming a colour renames it on every variant.
 */
export function ColorsManager() {
  const { t } = useI18n();
  const [colors, setColors] = useState<ColorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newNameTh, setNewNameTh] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const result = await requestJson<{ colors: ColorRow[] }>("/api/admin/colors", { method: "GET" });
    if (result.ok) {
      setColors(result.data.colors);
      setError(null);
    } else {
      setError(t("colors.loadFailed"));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change, reports the outcome, then reloads the list. */
  async function change(url: string, init: RequestInit, successKey: "colors.added" | "colors.saved" | "colors.deleted"): Promise<boolean> {
    setBusy(true);
    const result = await requestJson(url, init, { retries: 0 });
    setBusy(false);
    if (!result.ok) {
      toast.add({ title: t("colors.notSaved"), description: result.message ?? t("common.networkError"), type: "error" });
      return false;
    }
    toast.add({ title: t(successKey), type: "success" });
    await load();
    return true;
  }

  async function addColor(): Promise<void> {
    const ok = await change(
      "/api/admin/colors",
      json("POST", { code: newCode, name: newName.trim(), nameTh: newNameTh.trim() || null, sortOrder: colors.length + 1 }),
      "colors.added",
    );
    if (ok) {
      setNewCode("");
      setNewName("");
      setNewNameTh("");
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return;
    const sortOrder = Number(draft.sortOrder);
    const ok = await change(
      `/api/admin/colors/${draft.id}`,
      json("PATCH", {
        code: draft.code,
        name: draft.name.trim(),
        nameTh: draft.nameTh.trim() || null,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      }),
      "colors.saved",
    );
    if (ok) setDraft(null);
  }

  async function remove(row: ColorRow): Promise<void> {
    if (!window.confirm(t("colors.confirmDelete", { name: row.name }))) return;
    await change(`/api/admin/colors/${row.id}`, { method: "DELETE" }, "colors.deleted");
  }

  const codeValid = /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(newCode);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("colors.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("colors.desc")}</p>
        </div>
        <ActionBar onCreate={() => document.getElementById("colors-new-code")?.focus()} template="E" exportKind="colors" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("colors.list")}</CardTitle>
          <CardDescription>{t("colors.listHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
            <Input
              id="colors-new-code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              placeholder="00"
              aria-label={t("colors.code")}
              maxLength={20}
              className="font-mono"
            />
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("colors.nameEn")} maxLength={40} />
            <Input value={newNameTh} onChange={(e) => setNewNameTh(e.target.value)} placeholder={t("colors.nameTh")} maxLength={40} />
            <Button onClick={addColor} disabled={busy || !codeValid || !newName.trim()}>
              <Plus className="size-4" /> {t("colors.add")}
            </Button>
          </div>
          {newCode && !codeValid ? <p className="text-xs text-destructive">{CODE_RULE_MESSAGE}</p> : null}
          <p className="text-xs text-muted-foreground">{t("colors.codeHint")}</p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
            </p>
          ) : colors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("colors.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("colors.code")}</th>
                    <th className="px-3 py-2 font-medium">{t("colors.nameEn")}</th>
                    <th className="px-3 py-2 font-medium">{t("colors.nameTh")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("colors.sortOrder")}</th>
                    <th className="px-3 py-2 text-right font-medium" />
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {colors.map((row) =>
                    draft?.id === row.id ? (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">
                          <Input
                            value={draft.code}
                            onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                            maxLength={20}
                            aria-label={t("colors.code")}
                            className="font-mono"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} aria-label={t("colors.nameEn")} />
                        </td>
                        <td className="px-3 py-2">
                          <Input value={draft.nameTh} onChange={(e) => setDraft({ ...draft, nameTh: e.target.value })} maxLength={40} aria-label={t("colors.nameTh")} />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={draft.sortOrder}
                            onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                            inputMode="numeric"
                            aria-label={t("colors.sortOrder")}
                            className="ml-auto w-24 text-right"
                          />
                        </td>
                        <td />
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon-sm"
                              onClick={saveDraft}
                              disabled={busy || !draft.name.trim() || !/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(draft.code)}
                              aria-label={t("colors.save")}
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button size="icon-sm" variant="ghost" onClick={() => setDraft(null)} aria-label={t("common.cancel")}>
                              <X className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{row.code}</td>
                        <td className="px-3 py-2 font-medium">{row.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.nameTh ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.sortOrder}</td>
                        <td className="px-3 py-2 text-right text-xs text-muted-foreground">{t("colors.variants", { count: row.variantCount })}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setDraft({ id: row.id, code: row.code, name: row.name, nameTh: row.nameTh ?? "", sortOrder: String(row.sortOrder) })}
                              aria-label={t("colors.edit")}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={busy || row.variantCount > 0}
                              title={row.variantCount > 0 ? t("colors.inUse") : undefined}
                              onClick={() => void remove(row)}
                              aria-label={t("colors.delete")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
