"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, Loader2, PackagePlus, ScanLine, Search, Trash2 } from "lucide-react";
import { ActionBar } from "@/components/admin/action-bar";
import { ImportForm } from "@/components/admin/import-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useI18n } from "@/lib/i18n/client";
import type { ApiErrorBody, VariantSummary } from "@/lib/pos-types";

type MovementMode = "STOCK_IN" | "ADJUSTMENT";

const REASON_CODES = ["DAMAGED", "LOST", "COUNT_CORRECTION", "FOUND", "OTHER"] as const;
type ReasonCode = (typeof REASON_CODES)[number];

interface ReceiveLine {
  variant: VariantSummary;
  quantityChange: number;
}

interface ReceiveResult {
  variantId: string;
  sku: string;
  productName: string;
  quantityChange: number;
  stockBefore: number;
  stockAfter: number;
}

export default function ReceiveStockPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<MovementMode>("STOCK_IN");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reasonCode, setReasonCode] = useState<ReasonCode | "">("");
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResults, setLastResults] = useState<ReceiveResult[] | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search the catalogue as the user types. Results are cleared for empty queries.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed.");
        const body: { variants: VariantSummary[] } = await res.json();
        setResults(body.variants.slice(0, 30));
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function addVariant(variant: VariantSummary): void {
    setLastResults(null);
    setLines((current) => {
      if (current.some((line) => line.variant.id === variant.id)) {
        toast.add({ title: t("receive.alreadyAdded"), description: t("receive.alreadyAddedBody", { sku: variant.sku }), type: "info" });
        return current;
      }
      return [...current, { variant, quantityChange: mode === "STOCK_IN" ? 1 : -1 }];
    });
  }

  async function handleScan(barcode: string): Promise<void> {
    setLastScanned(barcode);
    try {
      const res = await fetch(`/api/products/search?barcode=${encodeURIComponent(barcode)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast.add({ title: t("receive.notFound"), description: body?.message ?? t("receive.noProductFor", { code: barcode }), type: "error" });
        return;
      }
      const body: { variant: VariantSummary } = await res.json();
      addVariant(body.variant);
    } catch {
      toast.add({ title: t("receive.scanFailed"), description: t("receive.scanNetwork"), type: "error" });
    }
  }

  useBarcodeScanner({ onScan: handleScan, enabled: !submitting });

  function updateQuantity(variantId: string, value: string): void {
    const parsed = Number(value);
    setLines((current) =>
      current.map((line) =>
        line.variant.id === variantId ? { ...line, quantityChange: Number.isFinite(parsed) ? Math.trunc(parsed) : 0 } : line,
      ),
    );
  }

  function removeLine(variantId: string): void {
    setLines((current) => current.filter((line) => line.variant.id !== variantId));
  }

  function validationMessage(): string | null {
    if (lines.length === 0) return t("receive.errAdd");
    if (mode === "STOCK_IN" && lines.some((line) => line.quantityChange <= 0)) {
      return t("receive.errQtyIn");
    }
    if (mode === "ADJUSTMENT") {
      if (lines.some((line) => line.quantityChange === 0)) return t("receive.errQtyAdj");
      if (!reasonCode) return t("receive.errReason");
      if (reasonCode === "OTHER" && note.trim().length < 3) return t("receive.errReasonOther");
    }
    return null;
  }

  async function submit(): Promise<void> {
    const problem = validationMessage();
    if (problem) {
      setError(problem);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/inventory/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: mode,
          reference: reference.trim() || null,
          note: note.trim() || null,
          reasonCode: mode === "ADJUSTMENT" ? reasonCode || null : null,
          lines: lines.map((line) => ({ variantId: line.variant.id, quantityChange: line.quantityChange })),
        }),
      });
      const body = (await res.json().catch(() => null)) as { results?: ReceiveResult[] } & ApiErrorBody;
      if (!res.ok || !body.results) {
        const message = body?.message ?? t("receive.failedMsg");
        setError(message);
        toast.add({ title: t("receive.notSaved"), description: message, type: "error" });
        return;
      }

      setLastResults(body.results);
      setLines([]);
      setReference("");
      setNote("");
      setReasonCode("");
      toast.add({
        title: mode === "STOCK_IN" ? t("receive.toastIn") : t("receive.toastAdj"),
        description: t("receive.toastBody", { count: body.results.length }),
        type: "success",
      });
    } catch {
      setError(t("receive.networkSave"));
    } finally {
      setSubmitting(false);
    }
  }

  const copy =
    mode === "STOCK_IN"
      ? { title: t("receive.titleIn"), description: t("receive.descIn"), submit: t("receive.submitIn") }
      : { title: t("receive.titleAdj"), description: t("receive.descAdj"), submit: t("receive.submitAdj") };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
            <p className="text-sm text-muted-foreground">{copy.description}</p>
          </div>
          <div className="flex rounded-md border p-1">
            {(["STOCK_IN", "ADJUSTMENT"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={mode === value ? "default" : "ghost"}
                onClick={() => {
                  setMode(value);
                  setLines([]);
                  setReasonCode("");
                  setError(null);
                }}
              >
                {value === "STOCK_IN" ? t("receive.modeIn") : t("receive.modeAdj")}
              </Button>
            ))}
          </div>
        </div>

        <ActionBar createHref="/admin/products/new" template="C" exportKind="inventory" />

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="size-4" /> {t("receive.find")}
              </CardTitle>
              <CardDescription className="flex items-center gap-2">
                <ScanLine className="size-4" />
                {lastScanned ? t("receive.lastScan", { code: lastScanned }) : t("receive.scannerReady")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("receive.searchPlaceholder")}
                aria-label={t("receive.searchAria")}
                className="h-11"
              />
              {searching ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {t("receive.searching")}
                </p>
              ) : null}
              {results.length > 0 ? (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                  {results.map((variant) => (
                    <li key={variant.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{variant.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {variant.size} · {variant.color} · <span className="font-mono">{variant.sku}</span> · {t("receive.stock", { count: variant.stockQuantity })}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => addVariant(variant)}>
                        {t("receive.add")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="size-4" /> {t("xls.bulkZone")}
              </CardTitle>
              <CardDescription>{t("xls.bulkZoneHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ImportForm type="C" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("receive.lines", { count: lines.length })}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lines.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">{t("receive.noLines")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t("receive.colVariant")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("receive.colOnHand")}</th>
                      <th className="px-4 py-2 text-right font-medium">{mode === "STOCK_IN" ? t("receive.colReceive") : t("receive.colChange")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("receive.colAfter")}</th>
                      <th className="w-10 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.variant.id} className="border-t">
                        <td className="px-4 py-2">
                          <p className="font-medium">{line.variant.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {line.variant.size} · {line.variant.color} · <span className="font-mono">{line.variant.sku}</span>
                          </p>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{line.variant.stockQuantity}</td>
                        <td className="px-4 py-2 text-right">
                          <Input
                            type="number"
                            step={1}
                            value={line.quantityChange}
                            onChange={(event) => updateQuantity(line.variant.id, event.target.value)}
                            className="ml-auto h-9 w-24 text-right tabular-nums"
                            aria-label={t("receive.qtyAria", { sku: line.variant.sku })}
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">
                          {line.variant.stockQuantity + line.quantityChange}
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("receive.removeAria", { sku: line.variant.sku })}
                            onClick={() => removeLine(line.variant.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {lastResults ? (
          <Card className="border-emerald-300 bg-emerald-50">
            <CardContent className="flex flex-col gap-2 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-emerald-800">
                <CheckCircle2 className="size-4" /> {t("receive.savedLedger")}
              </p>
              <ul className="flex flex-col gap-1">
                {lastResults.map((result) => (
                  <li key={result.variantId} className="flex justify-between gap-3">
                    <span className="font-mono">{result.sku}</span>
                    <span className="tabular-nums">
                      {result.stockBefore} → {result.stockAfter}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/admin/inventory" className="self-start text-emerald-800 underline">
                {t("receive.viewStock")}
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("receive.document")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {mode === "STOCK_IN" ? t("receive.refIn") : t("receive.refAdj")}
              </span>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} />
            </label>
            {mode === "ADJUSTMENT" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("receive.reasonAdj")}</span>
                <select
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value as ReasonCode | "")}
                  className="h-9 rounded-md border bg-background px-3"
                  aria-label={t("receive.reasonAdj")}
                >
                  <option value="">{t("receive.reasonChoose")}</option>
                  {REASON_CODES.map((code) => (
                    <option key={code} value={code}>
                      {t(`stockReason.${code}` as const)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {mode === "ADJUSTMENT" && reasonCode === "OTHER" ? t("receive.noteRequired") : t("receive.noteOpt")}
              </span>
              <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
            </label>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button size="lg" className="h-11" onClick={submit} disabled={submitting || lines.length === 0}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
              {copy.submit}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
