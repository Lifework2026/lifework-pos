"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Receipt } from "@/components/pos/receipt";
import type { OrderDetails } from "@/lib/pos-types";

/**
 * Prints one receipt on an 80mm thermal printer.
 *
 * The receipt is rendered into its own #print-root element, a direct child of <body>. The print stylesheet
 * (globals.css) removes everything else from the page, so no buttons, navigation or dialogs reach the paper,
 * and no blank pages are fed out. On screen the print copy is hidden.
 *
 * Usage: const { print, printRoot } = usePrintReceipt(); render {printRoot} once, call print(order).
 */
export function usePrintReceipt(): { print: (order: OrderDetails) => void; printRoot: React.ReactNode } {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [mounted, setMounted] = useState(false);
  const requested = useRef(false);

  useEffect(() => setMounted(true), []);

  const print = useCallback((next: OrderDetails) => {
    requested.current = true;
    setOrder(next);
  }, []);

  // Print after the receipt has been painted into #print-root, never before.
  useEffect(() => {
    if (!order || !requested.current) return;
    requested.current = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [order]);

  const printRoot =
    mounted && order
      ? createPortal(
          <div id="print-root" data-testid="print-root">
            <Receipt order={order} />
          </div>,
          document.body,
        )
      : null;

  return { print, printRoot };
}
