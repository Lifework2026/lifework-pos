/** Shapes shared by the held-bill API and the POS. Types only, so it is safe to import from client code. */

export interface HeldItem {
  variantId: string;
  quantity: number;
  /** Price on the till when the bill was parked, in baht. Used only to warn if it has changed. */
  unitPrice: number;
}

export interface HeldPayload {
  items: HeldItem[];
  discount: number;
  /** Basket total on the till when parked. Informational. */
  total: number;
}

export interface HeldBillSummary {
  id: string;
  label: string | null;
  itemCount: number;
  total: string;
  createdAt: string;
  createdBy: string | null;
}

export interface ResumedItem {
  variantId: string;
  name: string;
  nameTh: string | null;
  imageUrl: string | null;
  size: string;
  color: string;
  sku: string;
  barcode: string;
  price: number;
  stockQuantity: number;
  quantity: number;
}

export type ResumeWarning =
  | { kind: "REMOVED"; sku: string }
  | { kind: "REDUCED"; sku: string; from: number; to: number }
  | { kind: "PRICE_CHANGED"; sku: string; from: number; to: number };

export interface ResumedBill {
  items: ResumedItem[];
  discount: number;
  warnings: ResumeWarning[];
}
