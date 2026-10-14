/** Shared request and response types. Types only, so this file is safe to import from client code. */

/** Shape returned by the POS APIs for a sellable variant. Money is a fixed 2dp string. */
export interface VariantSummary {
  id: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  price: string;
  stockQuantity: number;
  product: {
    id: string;
    name: string;
    brand: string | null;
    categoryId: string;
  };
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface CashierSummary {
  id: string;
  fullName: string;
  username: string;
}

export interface OrderItemDetails {
  id: string;
  variantId: string;
  productName: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface OrderDetails {
  id: string;
  receiptNo: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  paymentMethod: string;
  amountReceived: string | null;
  changeAmount: string | null;
  createdAt: string;
  cashier: { id: string; fullName: string };
  edcPayment: { mode: string; transactionRef: string | null; approvalCode: string | null; cardMask: string | null } | null;
  items: OrderItemDetails[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

