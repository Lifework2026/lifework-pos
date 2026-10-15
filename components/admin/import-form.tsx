"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";
import { IMPORT_TEMPLATES, importEndpoint, templateHref, type TemplateKey } from "@/lib/template-catalog";

interface Issue {
  line: number;
  message: string;
}

interface Result {
  ok: boolean;
  issueCount?: number;
  issues?: Issue[];
  summary?: Record<string, number>;
  message?: string;
}

/**
 * Download the template, choose the filled-in file, check it, then import it once the check passes.
 * Nothing is saved until the check has passed and Import is pressed.
 */
export function ImportForm({ type }: { type: TemplateKey }) {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [checked, setChecked] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  async function run(mode: "preview" | "commit"): Promise<void> {
    if (!file) return;
    setBusy(mode === "preview" ? "check" : "import");
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    if (type !== "A") form.set("type", type);
    try {
      const res = await fetch(importEndpoint(type), { method: "POST", body: form, cache: "no-store" });
      const body = (await res.json().catch(() => null)) as Result | null;
      const result: Result = body ?? { ok: false, message: t("common.networkError") };
      if (mode === "preview") {
        setChecked(result);
        setDone(null);
      } else if (res.ok && result.ok) {
        setDone(result);
        setChecked(null);
        setFile(null);
        toast.add({ title: t("xls.doneToast"), type: "success" });
        router.refresh();
      } else {
        setChecked(result);
        toast.add({ title: t("xls.notImported"), description: result.message, type: "error" });
      }
    } catch {
      toast.add({ title: t("xls.notImported"), description: t("common.networkError"), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  const canImport = checked?.ok === true && file !== null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-mono text-xs text-muted-foreground">{IMPORT_TEMPLATES[type].columns}</p>
      <a
        href={templateHref(type)}
        className="inline-flex h-9 w-fit items-center gap-2 rounded-md border px-3 font-medium hover:bg-muted"
      >
        <Download className="size-4" /> {t("xls.download")}
      </a>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{t("xls.chooseFile")}</span>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setChecked(null);
            setDone(null);
          }}
          className="text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void run("preview")} disabled={!file || busy !== null}>
          {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("xls.check")}
        </Button>
        <Button onClick={() => void run("commit")} disabled={!canImport || busy !== null}>
          {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t("xls.import")}
        </Button>
      </div>

      {checked ? (
        checked.ok ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4" /> {t("xls.checkedOk")}
            </p>
            {checked.summary ? <SummaryList summary={checked.summary} /> : null}
          </div>
        ) : (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
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
        )
      ) : null}

      {done ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
          <p className="font-medium">{t("xls.doneTitle")}</p>
          {done.summary ? <SummaryList summary={done.summary} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryList({ summary }: { summary: Record<string, number> }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {Object.entries(summary).map(([key, value]) => (
        <li key={key} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{key}</span>
          <span className="tabular-nums font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}
