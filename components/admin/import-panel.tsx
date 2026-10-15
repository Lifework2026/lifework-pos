"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { ApiErrorBody } from "@/lib/pos-types";

interface Issue {
  line: number;
  message: string;
}

interface Summary {
  rows: number;
  newProducts: number;
  newVariants: number;
  updatedVariants: number;
  skippedVariants: number;
  stockMovements: number;
  newSizes: number;
}

interface PreviewResponse {
  ok: boolean;
  issueCount: number;
  issues: Issue[];
  unknownColumns?: string[];
  summary?: Summary;
  newProducts?: string[];
  newSizes?: string[];
  skipped?: { line: number; sku: string }[];
  updates?: { line: number; sku: string; name: string; priceBefore: string; priceAfter: string; stockBefore: number | null; stockAfter: number | null }[];
}

type Stage = "idle" | "checking" | "ready" | "problems" | "importing" | "done";

export function ImportPanel() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [onExisting, setOnExisting] = useState<"skip" | "update">("skip");
  const [applyStock, setApplyStock] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildForm(mode: "preview" | "commit"): FormData | null {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    form.append("onExisting", onExisting);
    form.append("applyStock", String(onExisting === "update" && applyStock));
    return form;
  }

  function resetResult(): void {
    setPreview(null);
    setDone(null);
    setError(null);
    setStage("idle");
  }

  async function check(): Promise<void> {
    const form = buildForm("preview");
    if (!form) return;
    setStage("checking");
    setError(null);
    try {
      const res = await fetch("/api/admin/products/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (PreviewResponse & ApiErrorBody) | null;
      if (!res.ok && !body?.issues) {
        setError(body?.message ?? t("import.failed"));
        setStage("idle");
        return;
      }
      setPreview(body);
      setStage(body?.ok ? "ready" : "problems");
    } catch {
      setError(t("common.networkError"));
      setStage("idle");
    }
  }

  async function run(): Promise<void> {
    const form = buildForm("commit");
    if (!form) return;
    setStage("importing");
    setError(null);
    try {
      const res = await fetch("/api/admin/products/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as ({ ok?: boolean; summary?: Summary } & Partial<PreviewResponse> & ApiErrorBody) | null;
      if (!res.ok || !body?.summary) {
        if (body?.issues) {
          setPreview({ ok: false, issueCount: body.issueCount ?? body.issues.length, issues: body.issues });
          setStage("problems");
        } else {
          setError(body?.message ?? t("import.failed"));
          setStage("ready");
        }
        return;
      }
      setDone(body.summary);
      setStage("done");
      toast.add({ title: t("import.done"), type: "success" });
    } catch {
      setError(t("common.networkError"));
      setStage("ready");
    }
  }

  const busy = stage === "checking" || stage === "importing";
  const summary = preview?.summary;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("import.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("import.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("import.step1")}</CardTitle>
          <CardDescription>{t("import.step1Desc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <a href="/api/admin/products/import/template?format=xlsx" className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
            <FileSpreadsheet className="size-4" /> {t("import.templateExcel")}
          </a>
          <a href="/api/admin/products/import/template?format=csv" className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
            <FileSpreadsheet className="size-4" /> {t("import.templateCsv")}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("import.step2")}</CardTitle>
          <CardDescription>{t("import.allOrNothing")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                resetResult();
              }}
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Upload className="size-4" /> {t("import.chooseFile")}
            </Button>
            <span className="text-sm text-muted-foreground">{file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : t("import.noFile")}</span>
          </div>

          <fieldset className="flex flex-col gap-2 text-sm" disabled={busy}>
            <legend className="mb-1 font-medium">{t("import.onExisting")}</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="onExisting"
                checked={onExisting === "skip"}
                onChange={() => {
                  setOnExisting("skip");
                  resetResult();
                }}
              />
              {t("import.skip")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="onExisting"
                checked={onExisting === "update"}
                onChange={() => {
                  setOnExisting("update");
                  resetResult();
                }}
              />
              {t("import.update")}
            </label>
            {onExisting === "update" ? (
              <label className="ml-6 flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={applyStock}
                  onChange={(event) => {
                    setApplyStock(event.target.checked);
                    resetResult();
                  }}
                />
                {t("import.applyStock")}
              </label>
            ) : null}
          </fieldset>

          <div>
            <Button onClick={check} disabled={!file || busy}>
              {stage === "checking" ? <Loader2 className="size-4 animate-spin" /> : null}
              {stage === "checking" ? t("import.checking") : t("import.check")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {stage === "problems" && preview ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{t("import.problems", { count: preview.issueCount })}</CardTitle>
            {preview.unknownColumns && preview.unknownColumns.length > 0 ? (
              <CardDescription>{t("import.unknownColumns", { list: preview.unknownColumns.join(", ") })}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="w-20 px-4 py-2 font-medium">{t("import.colLine")}</th>
                    <th className="px-4 py-2 font-medium">{t("import.colProblem")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.issues.map((issue, index) => (
                    <tr key={`${issue.line}-${index}`} className="border-t">
                      <td className="px-4 py-2 font-mono text-xs">{issue.line}</td>
                      <td className="px-4 py-2">{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.issueCount > preview.issues.length ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                {t("import.moreProblems", { shown: preview.issues.length, count: preview.issueCount })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {(stage === "ready" || stage === "importing") && summary ? (
        <Card className="border-emerald-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-800">
              <CheckCircle2 className="size-5" /> {t("import.readyTitle")}
            </CardTitle>
            <CardDescription>{t("import.step3")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label={t("import.sumRows")} value={summary.rows} />
              <Stat label={t("import.sumNewProducts")} value={summary.newProducts} />
              <Stat label={t("import.sumNewVariants")} value={summary.newVariants} />
              <Stat label={t("import.sumNewSizes")} value={summary.newSizes} />
              <Stat label={t("import.sumUpdated")} value={summary.updatedVariants} />
              <Stat label={t("import.sumSkipped")} value={summary.skippedVariants} />
              <Stat label={t("import.sumStock")} value={summary.stockMovements} />
            </dl>

            {preview?.updates && preview.updates.length > 0 ? (
              <div className="text-sm">
                <p className="mb-1 font-medium">{t("import.updatesTitle")}</p>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {preview.updates.map((update) => (
                    <li key={update.sku}>
                      <span className="font-mono">{update.sku}</span> · {t("import.updatePrice", { sku: update.name || update.sku, from: formatBaht(Number(update.priceBefore)), to: formatBaht(Number(update.priceAfter)) })}
                      {update.stockAfter !== null ? ` · ${t("import.updateStock", { from: update.stockBefore ?? 0, to: update.stockAfter })}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview?.skipped && preview.skipped.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("import.skippedTitle")}: {preview.skipped.map((entry) => entry.sku).join(", ")}
              </p>
            ) : null}

            <div>
              <Button size="lg" onClick={run} disabled={busy}>
                {stage === "importing" ? <Loader2 className="size-4 animate-spin" /> : null}
                {stage === "importing" ? t("import.running") : t("import.run")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {stage === "done" && done ? (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="flex flex-col gap-3 p-6">
            <p className="flex items-center gap-2 font-semibold text-emerald-800">
              <CheckCircle2 className="size-5" /> {t("import.done")}
            </p>
            <p className="text-sm text-emerald-900">
              {t("import.doneBody", { products: done.newProducts, variants: done.newVariants, updated: done.updatedVariants })}
            </p>
            <div className="flex gap-2">
              <Link href="/admin/products" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                {t("import.viewProducts")}
              </Link>
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  resetResult();
                }}
              >
                {t("import.again")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
