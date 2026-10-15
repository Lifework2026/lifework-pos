"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Receipt } from "@/components/pos/receipt";
import type { OrderDetails } from "@/lib/pos-types";

/**
 * Prints one document through a single print root, #print-root, a direct child of <body>.
 *
 * The print stylesheet (globals.css) removes everything else from the page, so no buttons, navigation or dialogs
 * reach the paper, and no blank pages are fed out. "receipt" prints on the 80mm roll; "a4" prints a full page
 * for tax invoices. On screen the print copy is hidden.
 */
export type PrintMode = "receipt" | "a4";

export function usePrintDocument(): { print: (content: ReactNode, mode?: PrintMode) => void; printRoot: ReactNode } {
  const [job, setJob] = useState<{ content: ReactNode; mode: PrintMode; id: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const print = useCallback((content: ReactNode, mode: PrintMode = "receipt") => {
    setJob({ content, mode, id: Date.now() });
  }, []);

  // Print after the document is painted into #print-root, never before. The page class selects the paper size.
  useEffect(() => {
    if (!job) return;
    const root = document.documentElement;
    if (job.mode === "a4") root.classList.add("printing-a4");
    const done = () => root.classList.remove("printing-a4");
    window.addEventListener("afterprint", done, { once: true });
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.removeEventListener("afterprint", done);
    };
  }, [job]);

  const printRoot =
    mounted && job
      ? createPortal(
          <div id="print-root" data-mode={job.mode} className={job.mode === "a4" ? "print-a4" : undefined} data-testid="print-root">
            {job.content}
          </div>,
          document.body,
        )
      : null;

  return { print, printRoot };
}

/** Prints a sale's receipt on an 80mm thermal printer. */
export function usePrintReceipt(): { print: (order: OrderDetails) => void; printRoot: ReactNode } {
  const { print, printRoot } = usePrintDocument();
  const printReceipt = useCallback((order: OrderDetails) => print(<Receipt order={order} />, "receipt"), [print]);
  return { print: printReceipt, printRoot };
}
