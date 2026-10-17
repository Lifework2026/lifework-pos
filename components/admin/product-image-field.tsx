"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { ProductThumb } from "@/components/pos/product-thumb";
import { Button } from "@/components/ui/button";
import { prepareProductPhoto } from "@/lib/client-image";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { ApiErrorBody } from "@/lib/pos-types";

export interface ProductImage {
  url: string;
  path: string;
}

interface ProductImageFieldProps {
  value: ProductImage | null;
  onChange: (next: ProductImage | null) => void;
  /** False when Supabase Storage is not configured. Uploads are disabled with an explanation. */
  storageReady: boolean;
  disabled?: boolean;
  alt: string;
  /**
   * Where to save the photo. When set, a photo is uploaded and saved there in one request, and Remove clears it at
   * once. Without it (a product that is not created yet) the photo is kept in the form and saved with the product.
   */
  saveUrl?: string | null;
}

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "removing" }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

const SAVED_MESSAGE_MS = 5000;

const ERROR_KEYS: Record<string, MessageKey> = {
  STORAGE_NOT_CONFIGURED: "img.notConfigured",
  FILE_TOO_LARGE: "img.tooLarge",
  UNSUPPORTED_TYPE: "img.unsupported",
};

/** Photo picker for a product. Resizes in the browser, uploads to storage, and saves the address on the product. */
export function ProductImageField({ value, onChange, storageReady, disabled, alt, saveUrl = null }: ProductImageFieldProps) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "uploading" || status.kind === "removing";

  // A success message fades away on its own. An error stays until the next action.
  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), SAVED_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function handleFile(file: File): Promise<void> {
    setStatus({ kind: "uploading" });
    try {
      const prepared = await prepareProductPhoto(file);
      const form = new FormData();
      form.append("file", prepared);
      const endpoint = saveUrl ?? "/api/admin/uploads/product-image";
      const res = await fetch(endpoint, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (Partial<ProductImage> & ApiErrorBody) | null;
      if (!res.ok || !body?.url || !body.path) {
        const key = body?.error ? ERROR_KEYS[body.error] : undefined;
        setStatus({ kind: "error", message: key ? t(key) : (body?.message ?? t("img.failed")) });
        return;
      }
      onChange({ url: body.url, path: body.path });
      setStatus({ kind: "saved", message: saveUrl ? t("img.savedToProduct") : t("img.readyToSave") });
      // The saved photo also shows in the product list, so refresh the server-rendered pages.
      if (saveUrl) router.refresh();
    } catch {
      setStatus({ kind: "error", message: t("img.failed") });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(): Promise<void> {
    if (!saveUrl) {
      onChange(null);
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "removing" });
    try {
      const res = await fetch(saveUrl, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setStatus({ kind: "error", message: body?.message ?? t("img.failed") });
        return;
      }
      onChange(null);
      setStatus({ kind: "saved", message: t("img.removedFromProduct") });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: t("img.failed") });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-4">
        <ProductThumb src={value?.url} alt={alt} className="size-28 shrink-0" />
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id={inputId}
            disabled={disabled || busy || !storageReady}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy || !storageReady}
            onClick={() => inputRef.current?.click()}
          >
            {status.kind === "uploading" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {value ? t("img.replace") : t("img.choose")}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={disabled || busy} onClick={() => void handleRemove()}>
              {status.kind === "removing" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} {t("img.remove")}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("img.hint")}</p>
        </div>
      </div>
      {!storageReady ? (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("img.notConfigured")}</p>
      ) : null}
      <div aria-live="polite" className="min-h-5">
        {status.kind === "uploading" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("img.uploading")}
          </p>
        ) : null}
        {status.kind === "removing" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
          </p>
        ) : null}
        {status.kind === "saved" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {status.message}
          </p>
        ) : null}
        {status.kind === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
