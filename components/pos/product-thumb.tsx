"use client";

import { useState } from "react";
import { Shirt } from "lucide-react";

interface ProductThumbProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
}

/**
 * Product photo with a neutral placeholder. Falls back to the placeholder if the image is missing or
 * fails to load, so a broken link never leaves a gap in the grid. Photos load lazily, since a grid
 * can hold hundreds of products.
 */
export function ProductThumb({ src, alt, className = "" }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  return (
    <div className={`relative overflow-hidden rounded-md bg-muted ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/60" aria-hidden>
          <Shirt className="size-1/2" />
        </div>
      )}
    </div>
  );
}
