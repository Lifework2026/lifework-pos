"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import type { ApiErrorBody, CategorySummary } from "@/lib/pos-types";

interface VariantRow {
  key: number;
  size: string;
  color: string;
  sku: string;
  barcode: string;
  price: string;
  initialStock: string;
}

interface ConflictDetails {
  skus?: string[];
  barcodes?: string[];
}

let nextRowKey = 1;

function emptyRow(): VariantRow {
  return { key: nextRowKey++, size: "", color: "", sku: "", barcode: "", price: "", initialStock: "0" };
}

export default function NewProductPage() {
  const router = useRouter();

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [rows, setRows] = useState<VariantRow[]>(() => [emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictDetails | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/categories", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load categories.");
        const body: { categories: CategorySummary[] } = await res.json();
        setCategories(body.categories);
        setCategoryId((current) => current || body.categories[0]?.id || "");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not load categories. Refresh the page and try again.");
      });
    return () => controller.abort();
  }, []);

  function updateRow(key: number, field: keyof Omit<VariantRow, "key">, value: string): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function removeRow(key: number): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  function clientProblem(): string | null {
    if (!name.trim()) return "Enter the product name.";
    if (!categoryId) return "Choose a category.";
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const label = `Variant ${index + 1}`;
      if (!row.size.trim() || !row.color.trim()) return `${label}: size and color are required.`;
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0) return `${label}: enter a price above zero.`;
      const stock = Number(row.initialStock);
      if (!Number.isInteger(stock) || stock < 0) return `${label}: initial stock must be zero or more.`;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const problem = clientProblem();
    if (problem) {
      setError(problem);
      return;
    }

    setSubmitting(true);
    setError(null);
    setConflicts(null);

    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          brand: brand.trim() || null,
          description: description.trim() || null,
          categoryId,
          variants: rows.map((row) => ({
            size: row.size.trim(),
            color: row.color.trim(),
            sku: row.sku.trim() || null,
            barcode: row.barcode.trim() || null,
            price: Number(row.price),
            initialStock: Number(row.initialStock),
          })),
        }),
      });

      const body = (await res.json().catch(() => null)) as
        | ({ product?: { name: string } } & ApiErrorBody)
        | null;

      if (!res.ok || !body?.product) {
        const message = body?.message ?? "Could not create the product. Nothing was saved.";
        setError(message);
        if (body?.error === "SKU_OR_BARCODE_EXISTS" && body.details) {
          setConflicts(body.details as ConflictDetails);
        }
        return;
      }

      toast.add({ title: "Product created", description: body.product.name, type: "success" });
      router.push("/admin/inventory");
      router.refresh();
    } catch {
      setError("Network error. Nothing was saved. Check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New product</h1>
        <p className="text-sm text-muted-foreground">
          Add a product with its size and color variants. Leave SKU or barcode blank to generate one.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
            <span className="font-medium">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Category</span>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="h-9 rounded-md border bg-background px-3"
              required
            >
              {categories.length === 0 ? <option value="">Loading...</option> : null}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Brand</span>
            <Input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
            <span className="font-medium">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Variants ({rows.length})</CardTitle>
            <CardDescription>One row per size and color. Price is in baht.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, emptyRow()])}>
            <Plus className="size-4" /> Add variant
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Color</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Barcode</th>
                <th className="px-3 py-2 font-medium">Price (฿)</th>
                <th className="px-3 py-2 font-medium">Initial stock</th>
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key} className="border-t">
                  <td className="px-3 py-2">
                    <Input
                      value={row.size}
                      onChange={(event) => updateRow(row.key, "size", event.target.value)}
                      placeholder="M"
                      aria-label={`Variant ${index + 1} size`}
                      className="h-9 w-24"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.color}
                      onChange={(event) => updateRow(row.key, "color", event.target.value)}
                      placeholder="Blue"
                      aria-label={`Variant ${index + 1} color`}
                      className="h-9 w-32"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.sku}
                      onChange={(event) => updateRow(row.key, "sku", event.target.value)}
                      placeholder="Auto"
                      aria-label={`Variant ${index + 1} SKU`}
                      className="h-9 w-40 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.barcode}
                      onChange={(event) => updateRow(row.key, "barcode", event.target.value)}
                      placeholder="Auto"
                      inputMode="numeric"
                      aria-label={`Variant ${index + 1} barcode`}
                      className="h-9 w-40 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.price}
                      onChange={(event) => updateRow(row.key, "price", event.target.value)}
                      aria-label={`Variant ${index + 1} price`}
                      className="h-9 w-28 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={row.initialStock}
                      onChange={(event) => updateRow(row.key, "initialStock", event.target.value)}
                      aria-label={`Variant ${index + 1} initial stock`}
                      className="h-9 w-24 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove variant ${index + 1}`}
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
              {conflicts.skus?.map((sku) => (
                <li key={`sku-${sku}`}>SKU in use: {sku}</li>
              ))}
              {conflicts.barcodes?.map((barcode) => (
                <li key={`bc-${barcode}`}>Barcode in use: {barcode}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.push("/admin/inventory")} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Create product
        </Button>
      </div>
    </form>
  );
}
