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
    nameTh: string | null;
    imageUrl: string | null;
    brand: string | null;
    categoryId: string;
  };
}

export interface CategorySummary {
  id: string;
  name: string;
  nameTh: string | null;
  slug: string;
}

export interface MemberSummary {
  id: string;
  name: string;
  phone: string;
  points: number;
}

export interface PromotionSummary {
  id: string;
  name: string;
  code: string | null;
  kind: "PERCENT_OFF" | "AMOUNT_OFF";
  scope: "ORDER" | "CATEGORY";
  value: string;
  minSubtotal: string;
  endsAt: string;
}

export interface OrderItemDetails {
  id: string;
  variantId: string;
  productName: string;
  productNameTh: string | null;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  isBag: boolean;
  quantity: number;
  refundedQuantity: number;
  unitPrice: string;
  lineSubtotal: string;
  discountAmount: string;
  netAmount: string;
  refundedAmount: string;
}

export interface PaymentDetails {
  id: string;
  method: string;
  amount: string;
  refundedAmount: string;
  tendered: string | null;
  changeGiven: string | null;
  reference: string | null;
  edcRef: { transactionRef: string | null; approvalCode: string | null; cardMask: string | null } | null;
}

export interface OrderDetails {
  id: string;
  receiptNo: string;
  status: string;
  createdAt: string;
  store: { name: string; branch: string; code: string };
  cashier: { id: string; fullName: string };
  member: { name: string; phone: string; pointsEarned: number; pointsRedeemed: number } | null;
  promotionName: string | null;
  bagType: string;
  subtotal: string;
  promotionDiscount: string;
  memberDiscount: string;
  manualDiscount: string;
  pointsDiscount: string;
  totalAmount: string;
  refundedAmount: string;
  voidReason: string | null;
  voidedAt: string | null;
  payments: PaymentDetails[];
  items: OrderItemDetails[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
