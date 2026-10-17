"use client";

import { useState } from "react";

/**
 * The Radog mark, shown behind a product that has no photo. It uses the brand artwork when the file is there:
 *
 *   public/brand/radog.png    the French bulldog head, black line art on white or transparent (PNG, about 400-800 px)
 *
 * The picture is multiplied onto the grey placeholder, so a white background disappears and the lines stay. If the file is
 * missing the built-in silhouette below is drawn instead, so the till never shows a broken image.
 */
export function RadogMark({ className }: { className?: string }) {
  const [missing, setMissing] = useState(false);

  if (!missing) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/brand/radog.png"
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setMissing(true)}
        className={`${className ?? ""} object-contain opacity-35 mix-blend-multiply`}
      />
    );
  }
  return <RadogSilhouette className={className} />;
}

/** A stand-in French bulldog silhouette (bat ears, heavy-lidded scowl, pale muzzle) used until the brand artwork is added. */
function RadogSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden focusable="false" className={className}>
      {/* ears */}
      <path d="M22 47C10 37 6 20 11 9c3-5 10-5 16 0 8 6 14 15 16 28z" />
      <path d="M78 47c12-10 16-27 11-38-3-5-10-5-16 0-8 6-14 15-16 28z" />
      {/* head, with the eyes and muzzle cut out and the nose and mouth line left in */}
      <path
        fillRule="evenodd"
        d="M20 46c4-12 16-16 30-16s26 4 30 16c5 6 7 16 4 24-2 8-8 14-14 17-6 5-34 5-40 0-6-3-12-9-14-17-3-8-1-18 4-24zM30.6 50.5h8.8a4.4 4.4 0 0 1-8.8 0zM60.6 50.5h8.8a4.4 4.4 0 0 1-8.8 0zM28 69c0-9 10-11 22-11s22 2 22 11c0 9-9 16-22 16s-22-7-22-16zM44 64c0-3 3-4 6-4s6 1 6 4-3 4-6 4-6-1-6-4zM49.2 68h1.6v6h-1.6z"
      />
    </svg>
  );
}
