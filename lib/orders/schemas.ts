import { z } from "zod";
import { MAX_PAYMENT_LINES, PAYMENT_METHOD_VALUES } from "@/lib/orders/payments";

/** Basket fields shared by quote and checkout. */
export const basketFields = {
  items: z
    .array(
      z.object({
        variantId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(999),
        unitPrice: z.number().nonnegative().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
  bag: z.enum(["NONE", "SMALL", "LARGE"]).default("NONE"),
  memberId: z.string().min(1).max(64).nullable().optional(),
  promotionId: z.string().min(1).max(64).nullable().optional(),
  redeemPoints: z.number().int().min(0).max(1_000_000).default(0),
  manualDiscount: z.number().min(0).max(10_000_000).default(0),
};

export const quoteSchema = z.object(basketFields);

export const checkoutSchema = z.object({
  ...basketFields,
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHOD_VALUES),
        amount: z.number().positive().max(10_000_000),
        tendered: z.number().nonnegative().max(10_000_000).nullable().optional(),
        reference: z.string().max(100).nullable().optional(),
        edcPaymentId: z.string().min(1).max(64).nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_PAYMENT_LINES),
});

export type QuoteInput = z.infer<typeof quoteSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
