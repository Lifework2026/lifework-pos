"use client";

import { useCallback, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { resolveScan, type ScanDecision } from "@/lib/scanner-input";

export interface UseScannerInputOptions {
  /** Text of the barcode field. The field is controlled by the caller. */
  value: string;
  setValue: (value: string) => void;
  /** Looks the code up and adds the item. Resolve true when it was added. Called the instant Enter arrives. */
  onScan: (decision: ScanDecision) => Promise<boolean> | boolean;
  /** Keeps the field focused while true. Turn it off while a dialog is open, so the dialog keeps its own focus. */
  enabled?: boolean;
  /** The field's id. The hook finds the field by it, because the shared Input does not forward a ref. */
  inputId: string;
}

/**
 * Scanner support for ONE field: the POS barcode box. There is no window-level key listener, so typing anywhere else
 * on the page is never touched.
 *
 *   - Enter in the field is the end of a scan. The lookup starts at once, with no debounce and no wait.
 *   - Thai layout characters (a scanner typing while the computer is set to Thai) are mapped back to English first.
 *   - Text that is not shaped like a barcode, such as a product name, is left alone for the normal search.
 *   - While enabled, focus returns to the field whenever nothing else holds it, so the next scan always lands here.
 */
export function useScannerInput({ value, setValue, onScan, enabled = true, inputId }: UseScannerInputOptions) {
  // Time of the first key typed into the empty field, to tell a scanner burst from a person typing.
  const startedAt = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (value === "") startedAt.current = null;
  }, [value]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      if (next === "") startedAt.current = null;
      else if (startedAt.current === null) startedAt.current = performance.now();
      setValue(next);
    },
    [setValue],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        startedAt.current = null;
        setValue("");
        return;
      }
      // Enter while an input method is still composing text belongs to the input method.
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

      const elapsed = startedAt.current === null ? null : performance.now() - startedAt.current;
      const decision = resolveScan(event.currentTarget.value, elapsed);
      if (!decision) return;

      event.preventDefault();
      startedAt.current = null;
      // A scan clears the field at once so the next scan starts empty. A typed code stays until it is found.
      if (decision.fast) setValue("");
      void Promise.resolve(onScanRef.current(decision)).then((added) => {
        if (added && !decision.fast) setValue("");
      });
    },
    [setValue],
  );

  // Focus: take it when nothing else has it, and take it back when it drifts to the page body.
  useEffect(() => {
    if (!enabled) return;
    const focusIfIdle = () => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      document.getElementById(inputId)?.focus();
    };
    const onFocusOut = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.id === inputId) window.setTimeout(focusIfIdle, 0);
    };
    focusIfIdle();
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("focus", focusIfIdle);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("focus", focusIfIdle);
    };
  }, [enabled, inputId]);

  return { handleChange, handleKeyDown };
}
