"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import type { ApiErrorBody, CategorySummary } from "@/lib/pos-types";

interface PromotionRow {
  id: string;
  name: string;
  code: string | null;
  kind: "PERCENT_OFF" | "AMOUNT_OFF";
  scope: "ORDER" | "CATEGORY";
  value: string;
  minSubtotal: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  category: { name: string } | null;
}

/** Converts a datetime-local value (store time, +07:00) into an ISO string. */
function localToIso(value: string): string {
  return new Date(value + ":00+07:00").toISOString();
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

export default function PromotionsPage() {
  const router = useRouter();
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    kind: "PERCENT_OFF" as "PERCENT_OFF" | "AMOUNT_OFF",
    scope: "ORDER" as "ORDER" | "CATEGORY",
    value: "",
    categoryId: "",
    minSubtotal: "0",
    startsAt: "",
    endsAt: "",
  });

  async function load(): Promise<void> {
    const [promoRes, catRes] = await Promise.all([
      fetch("/api/admin/promotions", { cache: "no-store" }),
      fetch("/api/categories", { cache: "no-store" }),
    ]);
    if (promoRes.ok) setPromotions(((await promoRes.json()) as { promotions: PromotionRow[] }).promotions);
    if (catRes.ok) setCategories(((await catRes.json()) as { categories: CategorySummary[] }).categories);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code.trim() || null,
          kind: form.kind,
          scope: form.scope,
          value: Number(form.value),
          categoryId: form.scope === "CATEGORY" ? form.categoryId : null,
          minSubtotal: Number(form.minSubtotal) || 0,
          startsAt: localToIso(form.startsAt),
          endsAt: localToIso(form.endsAt),
        }),
      });
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      if (!res.ok) {
        setError(body?.message ?? "Could not create the promotion.");
        return;
      }
      toast.add({ title: "Promotion created", type: "success" });
      setForm((current) => ({ ...current, name: "", code: "", value: "", minSubtotal: "0" }));
      await load();
      router.refresh();
    } catch {
      setError("Network error. Check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(promotion: PromotionRow): Promise<void> {
    const res = await fetch(`/api/admin/promotions/${promotion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !promotion.isActive }),
    });
    if (!res.ok) {
      toast.add({ title: "Could not update", description: "Try again.", type: "error" });
      return;
    }
    await load();
  }

  const fieldClass = "flex flex-col gap-1.5 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Promotions</h1>
        <p className="text-sm text-muted-foreground">
          Promotions apply at checkout. Shopping bags are never discounted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" /> New promotion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-4 md:grid-cols-3">
            <label className={`${fieldClass} md:col-span-2`}>
              <span className="font-medium">Name</span>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
            </label>
            <label className={fieldClass}>
              <span className="font-medium">Code (optional)</span>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={20} />
            </label>
            <label className={fieldClass}>
              <span className="font-medium">Type</span>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as "PERCENT_OFF" | "AMOUNT_OFF" })}
                className="h-9 rounded-md border bg-background px-3"
              >
                <option value="PERCENT_OFF">Percent off</option>
                <option value="AMOUNT_OFF">Baht off</option>
              </select>
            </label>
            <label className={fieldClass}>
              <span className="font-medium">{form.kind === "PERCENT_OFF" ? "Percent (0-100)" : "Baht off"}</span>
              <Input type="number" min={0} step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
            </label>
            <label className={fieldClass}>
              <span className="font-medium">Applies to</span>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as "ORDER" | "CATEGORY" })}
                className="h-9 rounded-md border bg-background px-3"
              >
                <option value="ORDER">Whole basket</option>
                <option value="CATEGORY">One category</option>
              </select>
            </label>
            {form.scope === "CATEGORY" ? (
              <label className={fieldClass}>
                <span className="font-medium">Category</span>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="h-9 rounded-md border bg-background px-3"
                  required
                >
                  <option value="">Choose…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className={fieldClass}>
              <span className="font-medium">Minimum spend (฿)</span>
              <Input type="number" min={0} step="0.01" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
            </label>
            <label className={fieldClass}>
              <span className="font-medium">Starts (Bangkok time)</span>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className="h-9 rounded-md border bg-background px-3"
                required
              />
            </label>
            <label className={fieldClass}>
              <span className="font-medium">Ends (Bangkok time)</span>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className="h-9 rounded-md border bg-background px-3"
                required
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive md:col-span-3">
                {error}
              </p>
            ) : null}
            <div className="md:col-span-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Create promotion
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Promotion</th>
              <th className="px-4 py-2 font-medium">Offer</th>
              <th className="px-4 py-2 font-medium">Applies to</th>
              <th className="px-4 py-2 font-medium">Valid</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : promotions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No promotions yet.
                </td>
              </tr>
            ) : (
              promotions.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2 font-medium">
                    {p.name}
                    {p.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{p.code}</span> : null}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {p.kind === "PERCENT_OFF" ? `${Number(p.value)}% off` : `${formatBaht(Number(p.value))} off`}
                    {Number(p.minSubtotal) > 0 ? (
                      <span className="block text-xs text-muted-foreground">Min {formatBaht(Number(p.minSubtotal))}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{p.scope === "CATEGORY" ? p.category?.name ?? "Category" : "Whole basket"}</td>
                  <td className="px-4 py-2 text-xs tabular-nums">
                    {new Date(p.startsAt).toLocaleString("en-GB", TIME_FORMAT)}
                    <br />
                    to {new Date(p.endsAt).toLocaleString("en-GB", TIME_FORMAT)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.isActive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
                    >
                      {p.isActive ? "Active" : "Off"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => toggle(p)}>
                      {p.isActive ? "Turn off" : "Turn on"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
