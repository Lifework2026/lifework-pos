"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { CategorySummary } from "@/lib/pos-types";

interface PromotionRow {
  id: string;
  name: string;
  code: string | null;
  kind: "PERCENT_OFF" | "AMOUNT_OFF";
  scope: "ORDER" | "CATEGORY";
  value: string;
  categoryId: string | null;
  minSubtotal: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  category: { name: string } | null;
}

interface FormState {
  name: string;
  code: string;
  kind: "PERCENT_OFF" | "AMOUNT_OFF";
  scope: "ORDER" | "CATEGORY";
  value: string;
  categoryId: string;
  minSubtotal: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  kind: "PERCENT_OFF",
  scope: "ORDER",
  value: "",
  categoryId: "",
  minSubtotal: "0",
  startsAt: "",
  endsAt: "",
};

/** datetime-local value (store time, +07:00) to an ISO string. */
function localToIso(value: string): string {
  return new Date(`${value}:00+07:00`).toISOString();
}

/** ISO string to a datetime-local value in store time. */
function isoToLocal(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 16);
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function toForm(row: PromotionRow): FormState {
  return {
    name: row.name,
    code: row.code ?? "",
    kind: row.kind,
    scope: row.scope,
    value: String(Number(row.value)),
    categoryId: row.categoryId ?? "",
    minSubtotal: String(Number(row.minSubtotal)),
    startsAt: isoToLocal(row.startsAt),
    endsAt: isoToLocal(row.endsAt),
  };
}

function toPayload(form: FormState) {
  return {
    name: form.name,
    code: form.code.trim() || null,
    kind: form.kind,
    scope: form.scope,
    value: Number(form.value),
    categoryId: form.scope === "CATEGORY" ? form.categoryId : null,
    minSubtotal: Number(form.minSubtotal) || 0,
    startsAt: localToIso(form.startsAt),
    endsAt: localToIso(form.endsAt),
  };
}

export default function PromotionsPage() {
  const { t, locale } = useI18n();
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PromotionRow | null>(null);

  const load = useCallback(async () => {
    const [promos, cats] = await Promise.all([
      requestJson<{ promotions: PromotionRow[] }>("/api/admin/promotions", { method: "GET" }),
      requestJson<{ categories: CategorySummary[] }>("/api/categories", { method: "GET" }),
    ]);
    if (promos.ok) setPromotions(promos.data.promotions);
    if (cats.ok) setCategories(cats.data.categories);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(promotion: PromotionRow): Promise<void> {
    const result = await requestJson(
      `/api/admin/promotions/${promotion.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !promotion.isActive }) },
      { retries: 0 },
    );
    if (!result.ok) {
      toast.add({ title: t("promo.updateFailed"), type: "error" });
      return;
    }
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("promo.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("promo.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" /> {t("promo.new")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PromotionForm
            categories={categories}
            submitLabel={t("promo.create")}
            onSubmit={async (form) => {
              const result = await requestJson(
                "/api/admin/promotions",
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(form)) },
                { retries: 0 },
              );
              if (result.ok) {
                toast.add({ title: t("promo.created"), type: "success" });
                await load();
              }
              return result.ok ? null : (result.message ?? t("common.networkError"));
            }}
            resetAfterSuccess
          />
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("promo.colPromotion")}</th>
              <th className="px-4 py-2 font-medium">{t("promo.colOffer")}</th>
              <th className="px-4 py-2 font-medium">{t("promo.appliesTo")}</th>
              <th className="px-4 py-2 font-medium">{t("promo.colValid")}</th>
              <th className="px-4 py-2 font-medium">{t("sales.colStatus")}</th>
              <th className="px-4 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loading")}
                </td>
              </tr>
            ) : promotions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t("promo.none")}
                </td>
              </tr>
            ) : (
              promotions.map((p) => {
                const category = categories.find((c) => c.id === p.categoryId);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-2 font-medium">
                      {p.name}
                      {p.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{p.code}</span> : null}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {p.kind === "PERCENT_OFF"
                        ? t("promo.percentOff", { value: Number(p.value) })
                        : t("promo.amountOff", { amount: formatBaht(Number(p.value)) })}
                      {Number(p.minSubtotal) > 0 ? (
                        <span className="block text-xs text-muted-foreground">{t("promo.minLabel", { amount: formatBaht(Number(p.minSubtotal)) })}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      {p.scope === "CATEGORY"
                        ? category
                          ? localizedName(locale, category.name, category.nameTh)
                          : (p.category?.name ?? t("promo.scopeCategory"))
                        : t("promo.scopeOrder")}
                    </td>
                    <td className="px-4 py-2 text-xs tabular-nums">
                      {new Date(p.startsAt).toLocaleString(locale === "th" ? "th-TH-u-ca-gregory" : "en-GB", TIME_FORMAT)}
                      <br />- {new Date(p.endsAt).toLocaleString(locale === "th" ? "th-TH-u-ca-gregory" : "en-GB", TIME_FORMAT)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.isActive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
                      >
                        {p.isActive ? t("promo.active") : t("promo.off")}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                          {t("products.edit")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggle(p)}>
                          {p.isActive ? t("promo.turnOff") : t("promo.turnOn")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("promo.edit")}</DialogTitle>
              <DialogDescription>{editing.name}</DialogDescription>
            </DialogHeader>
            <PromotionForm
              categories={categories}
              initial={toForm(editing)}
              submitLabel={t("catalog.save")}
              onCancel={() => setEditing(null)}
              onSubmit={async (form) => {
                const result = await requestJson(
                  `/api/admin/promotions/${editing.id}`,
                  { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(form)) },
                  { retries: 0 },
                );
                if (result.ok) {
                  toast.add({ title: t("promo.saved"), type: "success" });
                  setEditing(null);
                  await load();
                }
                return result.ok ? null : (result.message ?? t("common.networkError"));
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

interface PromotionFormProps {
  categories: CategorySummary[];
  initial?: FormState;
  submitLabel: string;
  /** Resolves to an error message, or null on success. */
  onSubmit: (form: FormState) => Promise<string | null>;
  onCancel?: () => void;
  resetAfterSuccess?: boolean;
}

function PromotionForm({ categories, initial, submitLabel, onSubmit, onCancel, resetAfterSuccess }: PromotionFormProps) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<FormState>(initial ?? EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const problem = await onSubmit(form);
    setSubmitting(false);
    if (problem) setError(problem);
    else if (resetAfterSuccess) setForm((current) => ({ ...EMPTY_FORM, startsAt: current.startsAt, endsAt: current.endsAt }));
  }

  const field = "flex flex-col gap-1.5 text-sm";
  const select = "h-9 rounded-md border bg-background px-3";

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-3">
      <label className={`${field} md:col-span-2`}>
        <span className="font-medium">{t("promo.name")}</span>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
      </label>
      <label className={field}>
        <span className="font-medium">{t("promo.code")}</span>
        <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={20} />
      </label>
      <label className={field}>
        <span className="font-medium">{t("promo.type")}</span>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as FormState["kind"] })} className={select}>
          <option value="PERCENT_OFF">{t("promo.typePercent")}</option>
          <option value="AMOUNT_OFF">{t("promo.typeAmount")}</option>
        </select>
      </label>
      <label className={field}>
        <span className="font-medium">{form.kind === "PERCENT_OFF" ? t("promo.valuePercent") : t("promo.valueAmount")}</span>
        <Input type="number" min={0} step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
      </label>
      <label className={field}>
        <span className="font-medium">{t("promo.appliesTo")}</span>
        <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as FormState["scope"] })} className={select}>
          <option value="ORDER">{t("promo.scopeOrder")}</option>
          <option value="CATEGORY">{t("promo.scopeCategory")}</option>
        </select>
      </label>
      {form.scope === "CATEGORY" ? (
        <label className={field}>
          <span className="font-medium">{t("promo.category")}</span>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={select} required>
            <option value="">{t("promo.choose")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {localizedName(locale, c.name, c.nameTh)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={field}>
        <span className="font-medium">{t("promo.minSpend")}</span>
        <Input type="number" min={0} step="0.01" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
      </label>
      <label className={field}>
        <span className="font-medium">{t("promo.starts")}</span>
        <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={select} required />
      </label>
      <label className={field}>
        <span className="font-medium">{t("promo.ends")}</span>
        <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={select} required />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive md:col-span-3">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
