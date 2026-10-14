"use client";

import { create } from "zustand";

/** A variant as it appears in the cart. `price` and `stockQuantity` are snapshots from the last lookup. */
export interface CartVariant {
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
}

export interface CartItem extends CartVariant {
  quantity: number;
}

export type AddItemResult =
  | { ok: true; quantity: number }
  | { ok: false; reason: "OUT_OF_STOCK"; available: number };

interface CartState {
  items: CartItem[];
  discount: number;

  addItemByBarcode: (variant: CartVariant) => AddItemResult;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clearCart: () => void;
  /** Replaces the whole cart, used when a held bill is resumed. */
  replaceCart: (items: CartItem[], discount: number) => void;
  setDiscount: (discount: number) => void;

  getSubtotal: () => number;
  getTotal: () => number;
}

/** Rounds to 2 decimal places (satang) to avoid floating-point drift in money math. */
const toMoney = (value: number): number => Math.round(value * 100) / 100;

export const useCartStore = create<CartState>()((set, get) => ({
  items: [],
  discount: 0,

  addItemByBarcode: (variant) => {
    const existing = get().items.find((item) => item.variantId === variant.variantId);
    const currentQuantity = existing?.quantity ?? 0;

    if (currentQuantity + 1 > variant.stockQuantity) {
      return { ok: false, reason: "OUT_OF_STOCK", available: variant.stockQuantity };
    }

    if (existing) {
      set({
        items: get().items.map((item) =>
          item.variantId === variant.variantId
            ? { ...item, quantity: item.quantity + 1, stockQuantity: variant.stockQuantity, price: variant.price }
            : item,
        ),
      });
      return { ok: true, quantity: currentQuantity + 1 };
    }

    set({ items: [...get().items, { ...variant, quantity: 1 }] });
    return { ok: true, quantity: 1 };
  },

  updateQuantity: (variantId, quantity) => {
    const item = get().items.find((i) => i.variantId === variantId);
    if (!item) return;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      get().removeItem(variantId);
      return;
    }

    // Clamp to available stock so the cart can never exceed what the shelf holds.
    const clamped = Math.min(quantity, item.stockQuantity);
    set({
      items: get().items.map((i) => (i.variantId === variantId ? { ...i, quantity: clamped } : i)),
    });
  },

  removeItem: (variantId) => {
    set({ items: get().items.filter((item) => item.variantId !== variantId) });
  },

  clearCart: () => {
    set({ items: [], discount: 0 });
  },

  replaceCart: (items, discount) => {
    set({ items, discount: Number.isFinite(discount) && discount > 0 ? toMoney(discount) : 0 });
  },

  setDiscount: (discount) => {
    const safe = Number.isFinite(discount) && discount > 0 ? toMoney(discount) : 0;
    set({ discount: safe });
  },

  getSubtotal: () => toMoney(get().items.reduce((sum, item) => sum + item.price * item.quantity, 0)),

  getTotal: () => {
    const total = get().getSubtotal() - get().discount;
    return Math.max(0, toMoney(total));
  },
}));
