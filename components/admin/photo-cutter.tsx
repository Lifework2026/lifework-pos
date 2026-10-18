"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Scissors, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findPhotoBlocks, padBox, type Box } from "@/lib/catalog/photo-detect";
import { styleColors, type StyleColor } from "@/lib/catalog/style-group";
import { prepareProductPhoto } from "@/lib/client-image";
import { parsePhotoName } from "@/lib/catalog/photo-files";
import { useI18n } from "@/lib/i18n/client";
import type { ApiErrorBody, StyleSummary } from "@/lib/pos-types";
import { cn } from "@/lib/utils";

interface CutBox extends Box {
  id: number;
  colorId: string;
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
}

const DETECT_WIDTH = 600;
let nextBoxId = 1;

/**
 * Cuts the photo of each colour out of a product page picture and saves it on that colour of the style. Choose the picture
 * saved from the web page, check or draw a box around each colour's photo, pick the colour from the style's own list (the
 * colours that are in the system, so the others on the page are simply left alone) and save. Each cut is shrunk and
 * uploaded through the same route as the colour photo field on the product page.
 */
export function PhotoCutter() {
  const { t } = useI18n();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const [styleCode, setStyleCode] = useState("");
  const [style, setStyle] = useState<StyleSummary | null>(null);
  const [styleState, setStyleState] = useState<"idle" | "loading" | "missing">("idle");
  const [boxes, setBoxes] = useState<CutBox[]>([]);
  const [drawing, setDrawing] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const colours: StyleColor[] = useMemo(() => (style ? styleColors(style.variants) : []), [style]);
  const hasPhoto = useMemo(() => new Set(style?.variants.filter((variant) => variant.ownPhoto).map((variant) => variant.colorId)), [style]);

  const loadStyle = useCallback(async (code: string): Promise<void> => {
    const wanted = code.trim().toUpperCase();
    if (!wanted) {
      setStyle(null);
      setStyleState("idle");
      return;
    }
    setStyleState("loading");
    try {
      const res = await fetch(`/api/products/styles?q=${encodeURIComponent(wanted)}`, { cache: "no-store" });
      const body = (await res.json()) as { styles?: StyleSummary[] };
      const found = body.styles?.find((candidate) => candidate.name.toUpperCase() === wanted) ?? null;
      setStyle(found);
      setStyleState(found ? "idle" : "missing");
    } catch {
      setStyle(null);
      setStyleState("missing");
    }
  }, []);

  // Look the style up a moment after the code stops changing.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadStyle(styleCode), 350);
    return () => window.clearTimeout(timer);
  }, [styleCode, loadStyle]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  function detect(image: HTMLImageElement): void {
    const scale = Math.min(1, DETECT_WIDTH / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const grey = new Uint8Array(width * height);
    for (let i = 0; i < grey.length; i++) grey[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    const found = findPhotoBlocks(grey, width, height).map((box) => {
      const padded = padBox(box, width, height);
      return { x: Math.round(padded.x / scale), y: Math.round(padded.y / scale), width: Math.round(padded.width / scale), height: Math.round(padded.height / scale) };
    });
    setBoxes(found.map((box) => ({ ...box, id: nextBoxId++, colorId: "", status: "idle" })));
  }

  function onFile(file: File | undefined): void {
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(URL.createObjectURL(file));
    setNatural(null);
    setBoxes([]);
    setFileName(file.name);
    const parsed = parsePhotoName(file.name.replace(/[\s_-]+(?=\.[A-Za-z]+$)/, ""));
    if (parsed) setStyleCode(parsed.style);
  }

  // The picture is shown scaled to the panel; boxes are kept in the picture's own pixels.
  function toPicture(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const element = event.currentTarget.getBoundingClientRect();
    if (!natural) return null;
    const x = Math.min(natural.width, Math.max(0, ((event.clientX - element.left) / element.width) * natural.width));
    const y = Math.min(natural.height, Math.max(0, ((event.clientY - element.top) / element.height) * natural.height));
    return { x, y };
  }

  function finishDrawing(): void {
    if (!drawing || !natural) return;
    const x = Math.min(drawing.x, drawing.x2);
    const y = Math.min(drawing.y, drawing.y2);
    const width = Math.abs(drawing.x2 - drawing.x);
    const height = Math.abs(drawing.y2 - drawing.y);
    setDrawing(null);
    if (width < natural.width * 0.04 || height < natural.width * 0.04) return;
    setBoxes((current) => [...current, { id: nextBoxId++, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), colorId: "", status: "idle" }]);
  }

  function setColour(id: number, colorId: string): void {
    setBoxes((current) => current.map((box) => (box.id === id ? { ...box, colorId, status: "idle", message: undefined } : box)));
  }

  /** Cuts one box out of the picture at full resolution. */
  async function cut(box: CutBox): Promise<File> {
    const image = imageRef.current;
    if (!image) throw new Error("no picture");
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, box.width, box.height);
    context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("cut failed");
    return new File([blob], "cut.png", { type: "image/png" });
  }

  async function saveAll(): Promise<void> {
    if (!style || saving) return;
    setSaving(true);
    for (const box of boxes) {
      if (!box.colorId || box.status === "saved") continue;
      setBoxes((current) => current.map((b) => (b.id === box.id ? { ...b, status: "saving" } : b)));
      try {
        const prepared = await prepareProductPhoto(await cut(box));
        const form = new FormData();
        form.append("file", prepared.file);
        const res = await fetch(`/api/admin/products/${style.id}/colors/${box.colorId}/image`, { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          throw new Error(body?.message ?? String(res.status));
        }
        setBoxes((current) => current.map((b) => (b.id === box.id ? { ...b, status: "saved", message: undefined } : b)));
      } catch (err) {
        setBoxes((current) => current.map((b) => (b.id === box.id ? { ...b, status: "error", message: err instanceof Error ? err.message : "error" } : b)));
      }
    }
    setSaving(false);
    await loadStyle(styleCode);
  }

  const ready = boxes.filter((box) => box.colorId && box.status !== "saved").length;
  const used = new Set(boxes.map((box) => box.colorId).filter(Boolean));
  const duplicate = (box: CutBox) => !!box.colorId && boxes.some((other) => other.id !== box.id && other.colorId === box.colorId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl">{t("cutter.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("cutter.intro")}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3 rounded-[4px] border bg-card p-3">
            <label className="flex flex-col gap-1 text-xs font-bold tracking-wide uppercase">
              {t("cutter.picture")}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onFile(event.target.files?.[0])} className="text-sm font-normal normal-case" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold tracking-wide uppercase">
              {t("cutter.style")}
              <Input value={styleCode} onChange={(event) => setStyleCode(event.target.value.toUpperCase())} placeholder="LW252DL229" className="num h-9 w-44 text-sm normal-case" />
            </label>
            {objectUrl ? (
              <Button type="button" variant="outline" size="sm" onClick={() => imageRef.current && detect(imageRef.current)} disabled={!natural}>
                <Wand2 className="size-4" /> {t("cutter.auto")}
              </Button>
            ) : null}
          </div>

          {styleState === "loading" ? <p className="text-sm text-muted-foreground">…</p> : null}
          {styleState === "missing" && styleCode.trim() ? (
            <p role="alert" className="text-sm text-destructive">
              {t("cutter.styleMissing", { code: styleCode })}
            </p>
          ) : null}
          {style ? (
            <p className="text-sm">
              <span className="font-bold">{t("cutter.coloursOfStyle")}:</span>{" "}
              {colours.map((colour) => `${colour.name}${hasPhoto.has(colour.colorId) ? " ✓" : ""}`).join(" · ")}
            </p>
          ) : null}

          {objectUrl ? (
            <div
              className="relative w-full max-w-[640px] cursor-crosshair touch-none overflow-hidden rounded-[4px] border bg-white select-none"
              onPointerDown={(event) => {
                const point = toPicture(event);
                if (!point) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrawing({ x: point.x, y: point.y, x2: point.x, y2: point.y });
              }}
              onPointerMove={(event) => {
                if (!drawing) return;
                const point = toPicture(event);
                if (point) setDrawing({ ...drawing, x2: point.x, y2: point.y });
              }}
              onPointerUp={finishDrawing}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imageRef}
                src={objectUrl}
                alt={fileName}
                draggable={false}
                className="block h-auto w-full"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setNatural({ width: image.naturalWidth, height: image.naturalHeight });
                  detect(image);
                }}
              />
              {natural
                ? boxes.map((box, index) => (
                    <div
                      key={box.id}
                      className={cn("absolute border-2", box.status === "saved" ? "border-emerald-600 bg-emerald-600/10" : box.colorId ? "border-foreground bg-foreground/5" : "border-amber-500 bg-amber-400/10")}
                      style={{ left: `${(box.x / natural.width) * 100}%`, top: `${(box.y / natural.height) * 100}%`, width: `${(box.width / natural.width) * 100}%`, height: `${(box.height / natural.height) * 100}%` }}
                    >
                      <span className="num absolute -top-px -left-px bg-foreground px-1.5 py-0.5 text-[11px] leading-none font-bold text-background">{index + 1}</span>
                    </div>
                  ))
                : null}
              {drawing && natural ? (
                <div
                  className="absolute border-2 border-dashed border-foreground bg-foreground/10"
                  style={{
                    left: `${(Math.min(drawing.x, drawing.x2) / natural.width) * 100}%`,
                    top: `${(Math.min(drawing.y, drawing.y2) / natural.height) * 100}%`,
                    width: `${(Math.abs(drawing.x2 - drawing.x) / natural.width) * 100}%`,
                    height: `${(Math.abs(drawing.y2 - drawing.y) / natural.height) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center rounded-[4px] border border-dashed text-sm text-muted-foreground">{t("cutter.empty")}</div>
          )}
          {objectUrl ? <p className="text-xs text-muted-foreground">{t("cutter.hint")}</p> : null}
        </div>

        <div className="flex flex-col gap-3">
          {boxes.length === 0 && objectUrl ? <p className="text-sm text-muted-foreground">{t("cutter.noBoxes")}</p> : null}
          {boxes.map((box, index) => (
            <div key={box.id} className="flex items-center gap-3 rounded-[4px] border bg-card p-2.5">
              <span className="num flex size-7 shrink-0 items-center justify-center bg-foreground text-xs font-bold text-background">{index + 1}</span>
              {objectUrl && natural ? (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center">
                  <div
                    className="overflow-hidden rounded-[3px] border bg-white"
                    style={{
                      // Same proportions as the box, fitted inside 96 px, so the preview is never stretched.
                      width: box.width >= box.height ? 96 : Math.round((96 * box.width) / box.height),
                      height: box.width >= box.height ? Math.round((96 * box.height) / box.width) : 96,
                      backgroundImage: `url(${objectUrl})`,
                      backgroundRepeat: "no-repeat",
                      backgroundSize: `${(natural.width / box.width) * 100}% ${(natural.height / box.height) * 100}%`,
                      backgroundPosition: `${box.width >= natural.width ? 0 : (box.x / (natural.width - box.width)) * 100}% ${box.height >= natural.height ? 0 : (box.y / (natural.height - box.height)) * 100}%`,
                    }}
                  />
                </div>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <select
                  value={box.colorId}
                  disabled={!style || box.status === "saving" || box.status === "saved"}
                  onChange={(event) => setColour(box.id, event.target.value)}
                  className="h-9 rounded-[3px] border bg-card px-2 text-sm"
                  aria-label={t("cutter.pickColour")}
                >
                  <option value="">{t("cutter.pickColour")}</option>
                  {colours.map((colour) => (
                    <option key={colour.colorId} value={colour.colorId} disabled={used.has(colour.colorId) && box.colorId !== colour.colorId}>
                      {colour.name}
                      {hasPhoto.has(colour.colorId) ? ` (${t("cutter.hasPhoto")})` : ""}
                    </option>
                  ))}
                </select>
                {duplicate(box) ? <p className="text-xs text-destructive">{t("cutter.duplicate")}</p> : null}
                {box.status === "saved" ? (
                  <p className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="size-3.5" /> {t("cutter.saved")}
                  </p>
                ) : null}
                {box.status === "saving" ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {t("cutter.saving")}
                  </p>
                ) : null}
                {box.status === "error" ? (
                  <p className="text-xs text-destructive">
                    {box.message}{" "}
                    {box.message?.includes("storage-check") ? (
                      <a href="/api/admin/storage-check" target="_blank" rel="noreferrer" className="font-bold underline">
                        {t("cutter.checkStorage")}
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cutter.remove")} disabled={box.status === "saving"} onClick={() => setBoxes((current) => current.filter((b) => b.id !== box.id))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {boxes.length > 0 ? (
            <Button type="button" size="lg" className="h-11 rounded-[3px] font-bold tracking-wide uppercase" disabled={!style || ready === 0 || saving} onClick={() => void saveAll()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
              {t("cutter.save", { count: ready })}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
