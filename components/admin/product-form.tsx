"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { ProductImageField, type ProductImage } from "@/components/admin/product-image-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";
import { localizedName } from "@/lib/payment-labels";
import type { ApiErrorBody } from "@/lib/pos-types";

export interface FormCategory {
  id: string;
  name: string;
  nameTh: string | null;
}

/** A colour from the master data. Variants are linked to it by id. */
export interface FormColor {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
}

export interface InitialVariant {
  id: string;
  size: string;
  color: string;
  colorId: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string | null;
  stockQuantity: number;
  isActive: boolean;
}

export interface InitialProduct {
  id: string;
  name: string;
  nameTh: string | null;
  brand: string | null;
  promoTag: string | null;
  description: string | null;
  categoryId: string;
  isActive: boolean;
  imageUrl: string | null;
  imagePath: string | null;
  variants: InitialVariant[];
}

interface Row {
  key: number;
  /** Set for variants that already exist. */
  id?: string;
  size: string;
  color: string;
  colorId: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  initialStock: string;
  stock: number;
  isActive: boolean;
}

interface ProductFormProps {
  mode: "create" | "edit";
  categories: FormCategory[];
  colors: FormColor[];
  sizes: string[];
  storageReady: boolean;
  initial?: InitialProduct;
}

let nextKey = 1;

function newRow(): Row {
  return { key: nextKey++, size: "", color: "", colorId: "", sku: "", barcode: "", price: "", cost: "", initialStock: "0", stock: 0, isActive: true };
}

function rowFromVariant(variant: InitialVariant): Row {
  return {
    key: nextKey++,
    id: variant.id,
    size: variant.size,
    color: variant.color,
    colorId: variant.colorId,
    sku: variant.sku,
    barcode: variant.barcode,
    price: variant.price,
    cost: variant.cost ?? "",
    initialStock: "0",
    stock: variant.stockQuantity,
    isActive: variant.isActive,
  };
}

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

export function ProductForm({ mode, categories, colors, sizes, storageReady, initial }: ProductFormProps) {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? "");
  const [nameTh, setNameTh] = useState(initial?.nameTh ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [promoTag, setPromoTag] = useState(initial?.promoTag ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [image, setImage] = useState<ProductImage | null>(
    initial?.imageUrl && initial.imagePath ? { url: initial.imageUrl, path: initial.imagePath } : null,
  );
  const [rows, setRows] = useState<Row[]>(() => (initial ? initial.variants.map(rowFromVariant) : [newRow()]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ skus?: string[]; barcodes?: string[] } | null>(null);

  function updateRow(key: number, patch: Partial<Row>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function validate(): string | null {
    if (!name.trim()) return t("products.errName");
    if (!categoryId) return t("products.errCategory");
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const n = index + 1;
      if (!row.size.trim() || !row.colorId) return t("products.errVariant", { n });
      if (!PRICE_PATTERN.test(row.price.trim()) || Number(row.price) <= 0) return t("products.errPrice", { n });
      if (row.cost.trim() !== "" && !PRICE_PATTERN.test(row.cost.trim())) return t("products.errCost", { n });
      if (!row.id && (!/^\d+$/.test(row.initialStock.trim()) || Number(row.initialStock) < 0)) return t("products.errStock", { n });
      const key = `${row.size.trim().toLowerCase()}|${row.colorId}`;
      if (seen.has(key)) return t("products.errDuplicate", { n });
      seen.add(key);
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setSubmitting(true);
    setError(null);
    setConflicts(null);

    const variants = rows.map((row) => ({
      ...(row.id ? { id: row.id, isActive: row.isActive } : { initialStock: Number(row.initialStock) }),
      size: row.size.trim(),
      colorId: row.colorId,
      sku: row.sku.trim() || null,
      barcode: row.barcode.trim() || null,
      price: Number(row.price),
      cost: row.cost.trim() === "" ? null : Number(row.cost),
    }));

    const imageChanged = (image?.url ?? null) !== (initial?.imageUrl ?? null);
    const common = {
      name: name.trim(),
      nameTh: nameTh.trim() || null,
      brand: brand.trim() || null,
      promoTag: promoTag.trim() || null,
      description: description.trim() || null,
      categoryId,
      variants,
    };

    try {
      const res =
        mode === "create"
          ? await fetch("/api/admin/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...common, imageUrl: image?.url ?? null, imagePath: image?.path ?? null }),
            })
          : await fetch(`/api/admin/products/${initial?.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...common,
                isActive,
                ...(imageChanged ? { imageUrl: image?.url ?? null, imagePath: image?.path ?? null } : {}),
              }),
            });

      const body = (await res.json().catch(() => null)) as (ApiErrorBody & { product?: { name?: string } }) | null;
      if (!res.ok) {
        setError(body?.message ?? t("products.saveFailed"));
        if (body?.error === "SKU_OR_BARCODE_EXISTS" && body.details) setConflicts(body.details as { skus?: string[]; barcodes?: string[] });
        return;
      }

      toast.add({ title: mode === "create" ? t("products.created") : t("products.saved"), description: name.trim(), type: "success" });
      router.push("/admin/products");
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!initial || submitting) return;
    if (!window.confirm(t("products.confirmDelete"))) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${initial.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      if (!res.ok) {
        setError(body?.error === "HAS_HISTORY" ? t("products.hasHistory") : (body?.message ?? t("products.saveFailed")));
        return;
      }
      toast.add({ title: t("products.deleted"), description: initial.name, type: "success" });
      router.push("/admin/products");
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{mode === "create" ? t("products.newTitle") : t("products.editTitle")}</h1>
        <p className="text-sm text-muted-foreground">{mode === "create" ? t("products.createDesc") : t("products.editDesc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("products.details")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
            <span className="font-medium">{t("products.name")}</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
            <span className="font-medium">{t("products.nameTh")}</span>
            <Input value={nameTh} onChange={(event) => setNameTh(event.target.value)} maxLength={150} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-center justify-between font-medium">
              {t("products.category")}
              <Link href="/admin/catalog" className="text-xs font-normal text-muted-foreground underline">
                {t("products.manageCategories")}
              </Link>
            </span>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="h-9 rounded-md border bg-background px-3"
              required
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {localizedName(locale, category.name, category.nameTh)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t("products.brand")}</span>
            <Input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t("products.promoTag")}</span>
            <Input value={promoTag} onChange={(event) => setPromoTag(event.target.value)} maxLength={30} placeholder="SALE, HOT, BUY 1 GET 1" />
            <span className="text-xs text-muted-foreground">{t("products.promoTagHint")}</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
            <span className="font-medium">{t("products.description")}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          {mode === "edit" ? (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="size-4" />
              <span className="font-medium">{t("products.active")}</span>
            </label>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("products.photo")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductImageField
            value={image}
            onChange={setImage}
            storageReady={storageReady}
            disabled={submitting}
            alt={name || t("products.photo")}
            productId={mode === "edit" ? (initial?.id ?? null) : null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("products.variants", { count: rows.length })}</CardTitle>
            <CardDescription>{t("products.variantsHint")}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, newRow()])}>
            <Plus className="size-4" /> {t("products.addVariant")}
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <datalist id="size-options">
            {sizes.map((size) => (
              <option key={size} value={size} />
            ))}
          </datalist>
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("products.colSize")}</th>
                <th className="px-3 py-2 font-medium">{t("products.colColor")}</th>
                <th className="px-3 py-2 font-medium">{t("products.colSku")}</th>
                <th className="px-3 py-2 font-medium">{t("products.colBarcode")}</th>
                <th className="px-3 py-2 font-medium">{t("products.colPrice")}</th>
                <th className="px-3 py-2 font-medium">{t("products.colCost")}</th>
                <th className="px-3 py-2 font-medium">{t("products.colStock")}</th>
                <th className="px-3 py-2 font-medium">{mode === "edit" ? t("products.colActive") : ""}</th>
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key} className={`border-t ${row.id && !row.isActive ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <Input
                      list="size-options"
                      value={row.size}
                      onChange={(event) => updateRow(row.key, { size: event.target.value })}
                      aria-label={`${t("products.colSize")} ${index + 1}`}
                      className="h-9 w-24"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.colorId}
                      onChange={(event) => {
                        const picked = colors.find((color) => color.id === event.target.value);
                        updateRow(row.key, { colorId: event.target.value, color: picked?.name ?? "" });
                      }}
                      aria-label={`${t("products.colColor")} ${index + 1}`}
                      className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">{t("products.chooseColor")}</option>
                      {colors.map((color) => (
                        <option key={color.id} value={color.id}>
                          {color.code} · {localizedName(locale, color.name, color.nameTh)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.sku}
                      onChange={(event) => updateRow(row.key, { sku: event.target.value })}
                      placeholder={row.id ? "" : t("products.auto")}
                      aria-label={`${t("products.colSku")} ${index + 1}`}
                      className="h-9 w-40 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.barcode}
                      onChange={(event) => updateRow(row.key, { barcode: event.target.value })}
                      placeholder={row.id ? "" : t("products.auto")}
                      aria-label={`${t("products.colBarcode")} ${index + 1}`}
                      className="h-9 w-40 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.price}
                      onChange={(event) => updateRow(row.key, { price: event.target.value })}
                      aria-label={`${t("products.colPrice")} ${index + 1}`}
                      className="h-9 w-28 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.cost}
                      onChange={(event) => updateRow(row.key, { cost: event.target.value })}
                      aria-label={`${t("products.colCost")} ${index + 1}`}
                      className="h-9 w-24 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row.id ? (
                      <div className="flex flex-col text-right tabular-nums">
                        <span className="font-medium">{row.stock}</span>
                        <Link href="/admin/inventory/receive" className="text-xs text-muted-foreground underline">
                          {t("products.stockLink")}
                        </Link>
                      </div>
                    ) : (
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={row.initialStock}
                        onChange={(event) => updateRow(row.key, { initialStock: event.target.value })}
                        aria-label={`${t("products.colStock")} ${index + 1}`}
                        className="h-9 w-24 text-right tabular-nums"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.id ? (
                      <input
                        type="checkbox"
                        checked={row.isActive}
                        onChange={(event) => updateRow(row.key, { isActive: event.target.checked })}
                        aria-label={`${t("products.colActive")} ${index + 1}`}
                        className="size-4"
                      />
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    {!row.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("products.removeVariant", { n: index + 1 })}
                        onClick={() => setRows((current) => (current.length > 1 ? current.filter((r) => r.key !== row.key) : current))}
                        disabled={rows.length === 1}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">{error}</p>
          {conflicts?.skus?.length || conflicts?.barcodes?.length ? (
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {conflicts.skus?.map((sku) => <li key={`sku-${sku}`}>{t("products.conflictSku", { sku })}</li>)}
              {conflicts.barcodes?.map((code) => <li key={`bc-${code}`}>{t("products.conflictBarcode", { code })}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {mode === "edit" ? (
            <Button type="button" variant="ghost" className="text-destructive" onClick={handleDelete} disabled={submitting}>
              <Trash2 className="size-4" /> {t("products.delete")}
            </Button>
          ) : null}
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => router.push("/admin/products")} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {mode === "create" ? t("products.create") : t("products.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
