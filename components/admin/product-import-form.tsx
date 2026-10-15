"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { ProductImportReview } from "@/components/admin/product-import-review";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";
import type { ProductCheckResult } from "@/lib/catalog/preview-types";
import { IMPORT_TEMPLATES, importEndpoint, templateHref } from "@/lib/template-catalog";

interface ProductImportFormProps {
  onCancel: () => void;
  onDone: () => void;
}

interface Failure {
  message: string;
  issues: { line: number; message: string }[];
}

/**
 * Template A in the import dialog: choose the file, check it, review every row side by side with the till's card,
 * then import. The import is one database transaction. If anything differs from the review, it rolls back and
 * nothing is saved.
 */
export function ProductImportForm({ onCancel, onDone }: ProductImportFormProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [checked, setChecked] = useState<ProductCheckResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function check(): Promise<void> {
    if (!file) return;
    setBusy("check");
    setFailure(null);
    const form = new FormData();
    form.set("file", file);
    form.set("mode", "preview");
    try {
      const res = await fetch(importEndpoint("A"), { method: "POST", body: form, cache: "no-store" });
      const body = (await res.json().catch(() => null)) as ProductCheckResult | null;
      setChecked(body ?? { ok: false, message: t("common.networkError") });
    } catch {
      setChecked({ ok: false, message: t("common.networkError") });
    } finally {
      setBusy(null);
    }
  }

  async function importAll(): Promise<void> {
    if (!file || !checked?.ok || !checked.summary) return;
    setBusy("import");
    setFailure(null);
    const form = new FormData();
    form.set("file", file);
    form.set("mode", "commit");
    // The number of rows the user reviewed. The server writes only if the database still agrees with it.
    form.set("expectedNewVariants", String(checked.summary.newVariants));
    try {
      const res = await fetch(importEndpoint("A"), { method: "POST", body: form, cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; issues?: Failure["issues"] } | null;
      if (res.ok && body?.ok) {
        toast.add({ title: t("xls.doneToast"), description: t("import.importedBody", { count: checked.summary.newVariants }), type: "success" });
        router.refresh();
        onDone();
        return;
      }
      setFailure({ message: body?.message ?? t("common.networkError"), issues: body?.issues ?? [] });
      // A rejected commit means the review is stale, so the user must check the file again.
      if (res.status === 409 || res.status === 422) setChecked(null);
    } catch {
      setFailure({ message: t("common.networkError"), issues: [] });
    } finally {
      setBusy(null);
    }
  }

  const newRows = checked?.ok ? (checked.summary?.newVariants ?? 0) : 0;
  const canImport = checked?.ok === true && file !== null && newRows > 0;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">{IMPORT_TEMPLATES.A.columns}</p>
        <a
          href={templateHref("A")}
          className="inline-flex h-9 w-fit items-center gap-2 rounded-md border px-3 font-medium hover:bg-muted"
        >
          <Download className="size-4" /> {t("xls.download")}
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-muted-foreground">{t("xls.chooseFile")}</span>
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setChecked(null);
              setFailure(null);
            }}
            className="text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5"
          />
        </label>
        <Button variant="outline" onClick={() => void check()} disabled={!file || busy !== null}>
          {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("xls.check")}
        </Button>
      </div>

      {checked?.ok && checked.summary ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" /> {t("import.checkPassed", { count: checked.preview?.rowCount ?? checked.summary.rows })}
          </p>
          {checked.summary.skippedVariants > 0 ? (
            <p className="mt-1 text-xs">{t("import.skippedNote", { count: checked.summary.skippedVariants })}</p>
          ) : null}
        </div>
      ) : null}

      {checked && !checked.ok ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <p className="font-medium">{t("xls.checkedProblems", { count: checked.issueCount ?? 0 })}</p>
          {checked.message ? <p>{checked.message}</p> : null}
          {checked.issues && checked.issues.length > 0 ? (
            <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5">
              {checked.issues.slice(0, 50).map((issue, index) => (
                <li key={index}>
                  {t("xls.line", { line: issue.line })}: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <p className="font-medium">{failure.message}</p>
          <p className="text-xs">{t("import.rolledBack")}</p>
          {failure.issues.length > 0 ? (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5">
              {failure.issues.slice(0, 50).map((issue, index) => (
                <li key={index}>
                  {t("xls.line", { line: issue.line })}: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {checked?.ok && checked.preview ? <ProductImportReview preview={checked.preview} /> : null}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onCancel} disabled={busy === "import"}>
          {t("import.cancel")}
        </Button>
        <Button onClick={() => void importAll()} disabled={!canImport || busy !== null}>
          {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t("import.importRows", { count: newRows })}
        </Button>
      </div>
    </div>
  );
}
