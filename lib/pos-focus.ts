/** The POS barcode field. Scanning is handled here and nowhere else on the page. */
export const BARCODE_INPUT_ID = "pos-barcode-input";

/**
 * Puts the cursor back in the barcode field. A mouse click on a product, a category or a cart button moves focus to that
 * button, and a scanner types into whatever has focus, so the next scan would be lost. Calling this after such a click
 * keeps the cashier's hands on the scanner.
 */
export function focusBarcodeField(): void {
  document.getElementById(BARCODE_INPUT_ID)?.focus();
}
