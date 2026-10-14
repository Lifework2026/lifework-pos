import { bahtToSatang, PricingError } from "@/lib/pricing";
import { OrderError } from "@/lib/orders/errors";

export const PAYMENT_METHOD_VALUES = ["CASH", "CARD", "QR_PROMPTPAY", "BANK_TRANSFER", "OTHER"] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHOD_VALUES)[number];

export const MAX_PAYMENT_LINES = 6;

export interface PaymentLineInput {
  method: PaymentMethodValue;
  /** Amount applied to the bill, in baht. */
  amount: number;
  /** Cash handed over, in baht. Cash lines only. */
  tendered?: number | null;
  /** Slip, transfer or QR reference. Required for QR and bank transfer. */
  reference?: string | null;
  /** Approved EDC payment. Required for card lines. */
  edcPaymentId?: string | null;
}

export interface NormalizedPaymentLine {
  method: PaymentMethodValue;
  amountSatang: number;
  tenderedSatang: number | null;
  changeSatang: number;
  reference: string | null;
  edcPaymentId: string | null;
}

/**
 * Checks the tender lines against the amount due. The lines must add up to the
 * amount due exactly, and each channel must carry what it needs.
 */
export function normalizePaymentLines(lines: PaymentLineInput[], dueSatang: number): NormalizedPaymentLine[] {
  if (lines.length === 0) {
    throw new OrderError(400, "PAYMENT_REQUIRED", "Add at least one payment.");
  }
  if (lines.length > MAX_PAYMENT_LINES) {
    throw new OrderError(400, "TOO_MANY_PAYMENT_LINES", `Use at most ${MAX_PAYMENT_LINES} payment lines.`);
  }

  const normalized: NormalizedPaymentLine[] = lines.map((line, index) => {
    let amountSatang: number;
    try {
      amountSatang = bahtToSatang(line.amount);
    } catch (err) {
      if (err instanceof PricingError) {
        throw new OrderError(400, "INVALID_AMOUNT", `Payment ${index + 1} has an invalid amount.`);
      }
      throw err;
    }
    if (amountSatang <= 0) {
      throw new OrderError(400, "INVALID_AMOUNT", `Payment ${index + 1} must be greater than zero.`);
    }

    const reference = line.reference?.trim() || null;

    if (line.method === "CASH") {
      if (line.tendered === undefined || line.tendered === null) {
        throw new OrderError(400, "CASH_TENDER_REQUIRED", "Enter the cash received.");
      }
      const tenderedSatang = bahtToSatang(line.tendered);
      if (tenderedSatang < amountSatang) {
        throw new OrderError(400, "INSUFFICIENT_TENDER", "Cash received is less than the cash applied.", {
          applied: amountSatang / 100,
          received: tenderedSatang / 100,
        });
      }
      return {
        method: "CASH",
        amountSatang,
        tenderedSatang,
        changeSatang: tenderedSatang - amountSatang,
        reference: null,
        edcPaymentId: null,
      };
    }

    if (line.tendered !== undefined && line.tendered !== null) {
      throw new OrderError(400, "TENDER_NOT_ALLOWED", "Only cash payments take a tendered amount.");
    }

    if (line.method === "CARD") {
      if (!line.edcPaymentId) {
        throw new OrderError(400, "EDC_PAYMENT_REQUIRED", "Card payments must be approved on the card terminal.");
      }
      return {
        method: "CARD",
        amountSatang,
        tenderedSatang: null,
        changeSatang: 0,
        reference: null,
        edcPaymentId: line.edcPaymentId,
      };
    }

    if ((line.method === "QR_PROMPTPAY" || line.method === "BANK_TRANSFER") && (!reference || reference.length < 3)) {
      throw new OrderError(400, "REFERENCE_REQUIRED", "Enter the transfer or QR reference from the payment.");
    }

    return {
      method: line.method,
      amountSatang,
      tenderedSatang: null,
      changeSatang: 0,
      reference,
      edcPaymentId: null,
    };
  });

  const edcIds = normalized.map((line) => line.edcPaymentId).filter((id): id is string => !!id);
  if (new Set(edcIds).size !== edcIds.length) {
    throw new OrderError(400, "DUPLICATE_CARD_PAYMENT", "The same card payment appears twice.");
  }

  const applied = normalized.reduce((sum, line) => sum + line.amountSatang, 0);
  if (applied !== dueSatang) {
    throw new OrderError(400, "PAYMENT_MISMATCH", "Payments must add up to the amount due.", {
      due: dueSatang / 100,
      applied: applied / 100,
    });
  }

  return normalized;
}
