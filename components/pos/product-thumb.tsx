"use client";

import { useState } from "react";
import { RadogMark } from "@/components/brand/radog-mark";
import { cn } from "@/lib/utils";

interface ProductThumbProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /**
   * "cover" fills the box and crops (small thumbnails). "contain" shows the whole picture on a white mat, so a photo is
   * never stretched or cropped; the till's product cards use it.
   */
  fit?: "cover" | "contain";
}

/**
 * Product photo with a brand placeholder: the Radog silhouette. Falls back to it if the image is missing or fails to
 * load, so a broken link never leaves a gap in the grid. Photos load lazily, since a grid can hold hundreds of products.
 */
export function ProductThumb({ src, alt, className = "", fit = "cover" }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover")}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-foreground/15" aria-hidden>
          <RadogMark className="size-3/5 max-h-full" />
        </div>
      )}
    </div>
  );
}
