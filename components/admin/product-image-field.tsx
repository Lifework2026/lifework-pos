"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
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
}

const ERROR_KEYS: Record<string, MessageKey> = {
  STORAGE_NOT_CONFIGURED: "img.notConfigured",
  FILE_TOO_LARGE: "img.tooLarge",
  UNSUPPORTED_TYPE: "img.unsupported",
};

/** Photo picker for a product. Resizes in the browser, uploads to storage, and reports the stored URL. */
export function ProductImageField({ value, onChange, storageReady, disabled, alt }: ProductImageFieldProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setUploading(true);
    try {
      const prepared = await prepareProductPhoto(file);
      const form = new FormData();
      form.append("file", prepared);
      const res = await fetch("/api/admin/uploads/product-image", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (Partial<ProductImage> & ApiErrorBody) | null;
      if (!res.ok || !body?.url || !body.path) {
        const key = body?.error ? ERROR_KEYS[body.error] : undefined;
        setError(key ? t(key) : (body?.message ?? t("img.failed")));
        return;
      }
      onChange({ url: body.url, path: body.path });
    } catch {
      setError(t("img.failed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
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
            id="product-photo"
            disabled={disabled || uploading || !storageReady}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploading || !storageReady}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {value ? t("img.replace") : t("img.choose")}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={disabled || uploading} onClick={() => onChange(null)}>
              <Trash2 className="size-4" /> {t("img.remove")}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("img.hint")}</p>
        </div>
      </div>
      {!storageReady ? (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">{t("img.notConfigured")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
