"use client";

import { useEffect, useRef } from "react";
import { thaiToEnglish } from "@/lib/keyboard/thai-keymap";

export interface UseBarcodeScannerOptions {
  /** Called with the scanned barcode once a complete scan ends with Enter. */
  onScan: (barcode: string) => void;
  /** Turn listening on or off, e.g. while a dialog is open. Defaults to true. */
  enabled?: boolean;
  /** Max gap between keystrokes for them to count as one scan. Scanners send in under 50ms. */
  maxKeyIntervalMs?: number;
  /** Shortest buffer accepted as a barcode. Guards against stray Enter presses. */
  minLength?: number;
  /** Longest buffer accepted as a barcode. */
  maxLength?: number;
  /** Also listen while focus is in an input, textarea or select. Off by default. */
  allowInInputs?: boolean;
}

const DEFAULT_MAX_KEY_INTERVAL_MS = 50;
const DEFAULT_MIN_LENGTH = 4;
const DEFAULT_MAX_LENGTH = 64;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/**
 * Captures input from a hardware barcode scanner (USB or Bluetooth HID).
 *
 * Scanners type the code as fast keystrokes and end with Enter. Keys that
 * arrive more than `maxKeyIntervalMs` apart are treated as human typing and
 * reset the buffer. Keys typed into form fields are ignored unless
 * `allowInInputs` is set, so the search box keeps working normally.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  maxKeyIntervalMs = DEFAULT_MAX_KEY_INTERVAL_MS,
  minLength = DEFAULT_MIN_LENGTH,
  maxLength = DEFAULT_MAX_LENGTH,
  allowInInputs = false,
}: UseBarcodeScannerOptions): void {
  // Keep the latest callback without re-subscribing the listener on every render.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastKeyAt = 0;

    const reset = () => {
      buffer = "";
      lastKeyAt = 0;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts and auto-repeat. Neither comes from a scanner.
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
        reset();
        return;
      }
      if (!allowInInputs && isEditableTarget(event.target)) {
        reset();
        return;
      }

      const now = performance.now();

      if (event.key === "Enter") {
        const scanned = buffer;
        const isValid = scanned.length >= minLength && scanned.length <= maxLength;
        reset();

        if (isValid) {
          // Stop the Enter from also activating a focused button.
          event.preventDefault();
          // A scanner typing while the computer is set to Thai is mapped back to the keys it pressed.
          onScanRef.current(thaiToEnglish(scanned));
        }
        return;
      }

      // Only printable characters belong to a scan. Shift, Tab and arrows are ignored.
      if (event.key.length !== 1) return;

      if (lastKeyAt !== 0 && now - lastKeyAt > maxKeyIntervalMs) {
        buffer = "";
      }

      buffer += event.key;
      lastKeyAt = now;

      if (buffer.length > maxLength) {
        reset();
        return;
      }

      // Second and later keys of a fast burst are scanner input, so stop them
      // from typing into whatever happens to have focus.
      if (buffer.length > 1) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, maxKeyIntervalMs, minLength, maxLength, allowInInputs]);
}
