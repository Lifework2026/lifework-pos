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

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
  productCount: number;
}

interface SizeRow {
  id: string;
  name: string;
  sortOrder: number;
  variantCount: number;
}

/** Manage the categories and sizes that product forms and the POS tabs are built from. */
export function CatalogManager() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [sizes, setSizes] = useState<SizeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCategory, setNewCategory] = useState("");
  const [newCategoryCode, setNewCategoryCode] = useState("");
  const [newCategoryTh, setNewCategoryTh] = useState("");
  const [editingCategory, setEditingCategory] = useState<{ id: string; code: string; name: string; nameTh: string } | null>(null);

  const [newSize, setNewSize] = useState("");
  const [editingSize, setEditingSize] = useState<{ id: string; name: string; sortOrder: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cats, szs] = await Promise.all([
      requestJson<{ categories: CategoryRow[] }>("/api/admin/categories", { method: "GET" }),
      requestJson<{ sizes: SizeRow[] }>("/api/admin/sizes", { method: "GET" }),
    ]);
    if (cats.ok) setCategories(cats.data.categories);
    if (szs.ok) setSizes(szs.data.sizes);
    if (!cats.ok || !szs.ok) setError(t("catalog.loadFailed"));
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a change, then reloads. Shows the server's message when it refuses. */
  async function change(request: () => Promise<{ ok: boolean; message?: string | null }>, successKey?: Parameters<typeof t>[0]): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await request();
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? t("common.networkError"));
      return false;
    }
    if (successKey) toast.add({ title: t(successKey), type: "success" });
    await load();
    return true;
  }

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  async function addCategory(): Promise<void> {
    const ok = await change(
      async () => {
        const r = await requestJson(
          "/api/admin/categories",
          json("POST", { code: newCategoryCode, name: newCategory, nameTh: newCategoryTh || null }),
          { retries: 0 },
        );
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      },
      "catalog.categoryAdded",
    );
    if (ok) {
      setNewCategory("");
      setNewCategoryTh("");
      setNewCategoryCode("");
    }
  }

  async function saveCategory(): Promise<void> {
    if (!editingCategory) return;
    const ok = await change(
      async () => {
        const r = await requestJson(
          `/api/admin/categories/${editingCategory.id}`,
          json("PATCH", { code: editingCategory.code, name: editingCategory.name, nameTh: editingCategory.nameTh || null }),
          { retries: 0 },
        );
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      },
      "catalog.saved",
    );
    if (ok) setEditingCategory(null);
  }

  async function removeCategory(row: CategoryRow): Promise<void> {
    if (!window.confirm(t("catalog.confirmDeleteCategory", { name: row.name }))) return;
    await change(
      async () => {
        const r = await requestJson(`/api/admin/categories/${row.id}`, { method: "DELETE" }, { retries: 0 });
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      },
      "catalog.deleted",
    );
  }

  async function addSize(): Promise<void> {
    const ok = await change(
      async () => {
        const r = await requestJson("/api/admin/sizes", json("POST", { name: newSize }), { retries: 0 });
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      },
      "catalog.sizeAdded",
    );
    if (ok) setNewSize("");
  }

  async function saveSize(): Promise<void> {
    if (!editingSize) return;
    const order = Number(editingSize.sortOrder);
    const ok = await change(
      async () => {
        const r = await requestJson(
          `/api/admin/sizes/${editingSize.id}`,
          json("PATCH", { name: editingSize.name, sortOrder: Number.isInteger(order) && order >= 0 ? order : undefined }),
          { retries: 0 },
        );
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      },
      "catalog.saved",
    );
    if (ok) setEditingSize(null);
  }

  async function removeSize(row: SizeRow): Promise<void> {
    if (!window.confirm(t("catalog.confirmDeleteSize", { name: row.name }))) return;
    await change(
      async () => {
        const r = await requestJson(`/api/admin/sizes/${row.id}`, { method: "DELETE" }, { retries: 0 });
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      },
      "catalog.deleted",
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("catalog.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("catalog.desc")}</p>
        </div>
        <ActionBar onCreate={() => document.getElementById("catalog-category-code")?.focus()} template="D" exportKind="categories" />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.categories")}</CardTitle>
            <CardDescription>{t("catalog.categoriesHint")}</CardDescription>
            <p className="text-xs text-muted-foreground">{t("catalog.codeHint")}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
              <Input
                id="catalog-category-code"
                value={newCategoryCode}
                onChange={(e) => setNewCategoryCode(e.target.value.toUpperCase())}
                placeholder={t("catalog.codePlaceholder")}
                aria-label={t("catalog.code")}
                maxLength={20}
                className="font-mono"
              />
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t("catalog.nameEn")} maxLength={80} />
              <Input value={newCategoryTh} onChange={(e) => setNewCategoryTh(e.target.value)} placeholder={t("catalog.nameTh")} maxLength={80} />
              <Button onClick={addCategory} disabled={busy || !newCategory.trim() || !newCategoryCode.trim()}>
                <Plus className="size-4" /> {t("catalog.add")}
              </Button>
            </div>

            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
              </p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("catalog.noCategories")}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[460px] text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("catalog.code")}</th>
                      <th className="px-3 py-2 font-medium">{t("catalog.nameEn")}</th>
                      <th className="px-3 py-2 font-medium">{t("catalog.nameTh")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((row) =>
                      editingCategory?.id === row.id ? (
                        <tr key={row.id} className="border-t">
                          <td className="px-3 py-2">
                            <Input
                              value={editingCategory.code}
                              onChange={(e) => setEditingCategory({ ...editingCategory, code: e.target.value.toUpperCase() })}
                              maxLength={20}
                              aria-label={t("catalog.code")}
                              className="font-mono"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={editingCategory.name}
                              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                              maxLength={80}
                              aria-label={t("catalog.nameEn")}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={editingCategory.nameTh}
                              onChange={(e) => setEditingCategory({ ...editingCategory, nameTh: e.target.value })}
                              maxLength={80}
                              aria-label={t("catalog.nameTh")}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <Button size="icon-sm" onClick={saveCategory} disabled={busy || !editingCategory.name.trim() || !editingCategory.code.trim()} aria-label={t("catalog.save")}>
                                <Check className="size-4" />
                              </Button>
                              <Button size="icon-sm" variant="ghost" onClick={() => setEditingCategory(null)} aria-label={t("common.cancel")}>
                                <X className="size-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={row.id} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs font-semibold">{row.code}</td>
                          <td className="px-3 py-2">
                            <p className="font-medium">{row.name}</p>
                            <p className="text-xs text-muted-foreground">{t("catalog.productCount", { count: row.productCount })}</p>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.nameTh ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => setEditingCategory({ id: row.id, code: row.code, name: row.name, nameTh: row.nameTh ?? "" })}
                                aria-label={t("products.edit")}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => removeCategory(row)}
                                disabled={busy || row.productCount > 0}
                                title={row.productCount > 0 ? t("catalog.inUse") : undefined}
                                aria-label={t("catalog.delete")}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.sizes")}</CardTitle>
            <CardDescription>{t("catalog.sizesHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder={t("catalog.sizePlaceholder")} maxLength={20} />
              <Button onClick={addSize} disabled={busy || !newSize.trim()}>
                <Plus className="size-4" /> {t("catalog.add")}
              </Button>
            </div>

            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
              </p>
            ) : sizes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("catalog.noSizes")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sizes.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    {editingSize?.id === row.id ? (
                      <>
                        <div className="flex flex-1 gap-2">
                          <Input
                            value={editingSize.name}
                            onChange={(e) => setEditingSize({ ...editingSize, name: e.target.value })}
                            maxLength={20}
                            aria-label={t("products.colSize")}
                            className="w-28"
                          />
                          <Input
                            type="number"
                            min={0}
                            value={editingSize.sortOrder}
                            onChange={(e) => setEditingSize({ ...editingSize, sortOrder: e.target.value })}
                            aria-label={t("catalog.order")}
                            className="w-24"
                          />
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon-sm" onClick={saveSize} disabled={busy || !editingSize.name.trim()} aria-label={t("catalog.save")}>
                            <Check className="size-4" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" onClick={() => setEditingSize(null)} aria-label={t("common.cancel")}>
                            <X className="size-4" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm">
                          <span className="font-medium">{row.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{t("catalog.variantCount", { count: row.variantCount })}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setEditingSize({ id: row.id, name: row.name, sortOrder: String(row.sortOrder) })}
                            aria-label={t("products.edit")}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => removeSize(row)}
                            disabled={busy || row.variantCount > 0}
                            title={row.variantCount > 0 ? t("catalog.inUse") : undefined}
                            aria-label={t("catalog.delete")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
