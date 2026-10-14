import { Prisma, type EdcPayment } from "@prisma/client";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/api";
import { BridgeEdcProvider, toTerminalState, type BridgeStatusResponse } from "./bridge-provider";
import { SimulatorEdcProvider } from "./simulator-provider";
import {
  EdcUnavailableError,
  type EdcPaymentDto,
  type EdcProvider,
  type EdcTerminalState,
} from "./types";

/**
 * EDC payment service. It is the only code that changes EdcPayment rows.
 *
 * Lifecycle: PENDING -> SUCCESS | FAILED | CANCELLED | TIMED_OUT. A status
 * arrives by polling the terminal, or by a webhook from the bridge. Both paths
 * use the same guarded update, so a payment is finalized exactly once.
 */

const DEFAULT_TIMEOUT_MS = 120_000;
const TRANSACTION_REF_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

export class EdcServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EdcServiceError";
  }
}

let cachedProvider: EdcProvider | null = null;

/** Chooses the terminal transport from EDC_MODE. The simulator is refused in production. */
export function getEdcProvider(): EdcProvider {
  if (cachedProvider) return cachedProvider;

  const mode = (process.env.EDC_MODE ?? "simulator").trim().toLowerCase();

  if (mode === "bridge") {
    const baseUrl = process.env.EDC_BRIDGE_URL;
    if (!baseUrl) throw new Error("EDC_BRIDGE_URL is required when EDC_MODE=bridge.");
    cachedProvider = new BridgeEdcProvider({
      baseUrl: baseUrl.replace(/\/$/, ""),
      token: process.env.EDC_BRIDGE_TOKEN ?? "",
    });
  } else if (mode === "simulator") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("The EDC simulator cannot run in production. Set EDC_MODE=bridge.");
    }
    cachedProvider = new SimulatorEdcProvider();
  } else {
    throw new Error(`Unknown EDC_MODE "${mode}". Use "bridge" or "simulator".`);
  }

  return cachedProvider;
}

function paymentTimeoutMs(): number {
  const parsed = Number(process.env.EDC_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed >= 10_000 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function toEdcPaymentDto(payment: EdcPayment, terminalUnreachable = false): EdcPaymentDto {
  return {
    id: payment.id,
    mode: payment.mode,
    status: payment.status,
    amount: formatMoney(payment.amount),
    transactionRef: payment.transactionRef,
    approvalCode: payment.approvalCode,
    cardMask: payment.cardMask,
    failureReason: payment.failureReason,
    expiresAt: payment.expiresAt.toISOString(),
    completedAt: payment.completedAt?.toISOString() ?? null,
    terminalUnreachable,
  };
}

function parseAmount(amount: number): Prisma.Decimal {
  const money = new Prisma.Decimal(amount).toDecimalPlaces(2);
  if (!Number.isFinite(amount) || money.lte(0)) {
    throw new EdcServiceError(400, "INVALID_AMOUNT", "The payment amount must be greater than zero.");
  }
  return money;
}

/** Sends the amount to the terminal and returns a PENDING payment the client can poll. */
export async function startEdcPayment(input: { amount: number; userId: string }): Promise<EdcPaymentDto> {
  const amount = parseAmount(input.amount);
  const provider = getEdcProvider();
  const timeoutMs = paymentTimeoutMs();

  const payment = await prisma.edcPayment.create({
    data: {
      mode: provider.mode,
      status: "PENDING",
      amount,
      expiresAt: new Date(Date.now() + timeoutMs),
      createdById: input.userId,
    },
  });

  try {
    const { externalSessionId } = await provider.start({
      requestId: payment.id,
      amountSatang: Math.round(amount.toNumber() * 100),
      currency: "THB",
      reference: payment.id,
      timeoutMs,
    });
    const updated = await prisma.edcPayment.update({
      where: { id: payment.id },
      data: { externalSessionId },
    });
    return toEdcPaymentDto(updated);
  } catch (err) {
    if (err instanceof EdcUnavailableError) {
      const failed = await prisma.edcPayment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failureReason: "The card terminal is not responding. Check the terminal or use manual entry.",
          completedAt: new Date(),
        },
      });
      return toEdcPaymentDto(failed, true);
    }
    throw err;
  }
}

/**
 * Moves a PENDING payment to its final state. The update is guarded on
 * status = PENDING, so a poll and a webhook racing each other cannot both finalize it.
 */
async function applyTerminalState(payment: EdcPayment, terminal: EdcTerminalState): Promise<EdcPayment> {
  if (terminal.state === "PENDING") return payment;

  const now = new Date();
  let data: Prisma.EdcPaymentUpdateManyMutationInput;

  switch (terminal.state) {
    case "APPROVED":
      data = {
        status: "SUCCESS",
        transactionRef: terminal.transactionRef,
        approvalCode: terminal.approvalCode,
        cardMask: terminal.cardMask,
        completedAt: now,
      };
      break;
    case "DECLINED":
      data = { status: "FAILED", failureReason: terminal.reason, completedAt: now };
      break;
    case "CANCELLED":
      data = { status: "CANCELLED", failureReason: "Cancelled on the terminal.", completedAt: now };
      break;
    case "TIMEOUT":
      data = { status: "TIMED_OUT", failureReason: "The card was not presented in time.", completedAt: now };
      break;
  }

  try {
    await prisma.edcPayment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data,
    });
  } catch (err) {
    // The unique transaction reference is already used by another payment. Never approve it twice.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await prisma.edcPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: "This transaction reference was already used.", completedAt: now },
      });
    } else {
      throw err;
    }
  }

  return prisma.edcPayment.findUniqueOrThrow({ where: { id: payment.id } });
}

async function findPaymentOrThrow(id: string): Promise<EdcPayment> {
  const payment = await prisma.edcPayment.findUnique({ where: { id } });
  if (!payment) throw new EdcServiceError(404, "EDC_PAYMENT_NOT_FOUND", "Card payment not found.");
  return payment;
}

/**
 * Returns the current payment state. While PENDING, asks the terminal for an
 * update. The client calls this on an interval (polling) until the state is final.
 */
export async function refreshEdcPayment(id: string): Promise<EdcPaymentDto> {
  let payment = await findPaymentOrThrow(id);
  if (payment.status !== "PENDING" || payment.mode === "MANUAL") {
    return toEdcPaymentDto(payment);
  }

  if (payment.expiresAt.getTime() <= Date.now()) {
    if (payment.externalSessionId) {
      await getEdcProvider().cancel(payment.externalSessionId).catch(() => undefined);
    }
    payment = await applyTerminalState(payment, { state: "TIMEOUT" });
    return toEdcPaymentDto(payment);
  }

  if (!payment.externalSessionId) {
    return toEdcPaymentDto(payment);
  }

  try {
    const terminal = await getEdcProvider().poll(payment.externalSessionId);
    payment = await applyTerminalState(payment, terminal);
    return toEdcPaymentDto(payment);
  } catch (err) {
    if (err instanceof EdcUnavailableError) {
      // Keep the payment pending. The card may still be processing, so the cashier decides next.
      return toEdcPaymentDto(payment, true);
    }
    throw err;
  }
}

/**
 * Cancels a pending payment on the terminal. The local record is marked
 * CANCELLED only after the terminal confirms, because the card may still be processed.
 */
export async function cancelEdcPayment(id: string): Promise<EdcPaymentDto> {
  const payment = await findPaymentOrThrow(id);
  if (payment.status !== "PENDING") return toEdcPaymentDto(payment);

  if (payment.mode !== "MANUAL" && payment.externalSessionId) {
    try {
      await getEdcProvider().cancel(payment.externalSessionId);
    } catch (err) {
      if (err instanceof EdcUnavailableError) {
        throw new EdcServiceError(
          502,
          "EDC_UNAVAILABLE",
          "Could not reach the terminal to cancel. Check the terminal before retrying.",
        );
      }
      throw err;
    }
  }

  const cancelled = await applyTerminalState(payment, { state: "CANCELLED" });
  return toEdcPaymentDto(cancelled);
}

/**
 * Records a payment the cashier confirmed by hand, from the terminal's receipt.
 * Used when the bridge is down. The reference must be unique, so one slip can't pay two sales.
 */
export async function recordManualEdcPayment(input: {
  amount: number;
  transactionRef: string;
  approvalCode: string | null;
  userId: string;
}): Promise<EdcPaymentDto> {
  const amount = parseAmount(input.amount);
  const reference = input.transactionRef.trim();
  if (!TRANSACTION_REF_PATTERN.test(reference)) {
    throw new EdcServiceError(400, "INVALID_REFERENCE", "Transaction reference must be 4 to 64 letters, digits or dashes.");
  }

  try {
    const payment = await prisma.edcPayment.create({
      data: {
        mode: "MANUAL",
        status: "SUCCESS",
        amount,
        transactionRef: reference,
        approvalCode: input.approvalCode?.trim() || null,
        expiresAt: new Date(),
        completedAt: new Date(),
        createdById: input.userId,
      },
    });
    return toEdcPaymentDto(payment);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EdcServiceError(409, "REFERENCE_ALREADY_USED", "This transaction reference has already been recorded.");
    }
    throw err;
  }
}

/** Verifies the shared webhook secret in constant time. */
export function isValidWebhookSecret(presented: string | null): boolean {
  const expected = process.env.EDC_WEBHOOK_SECRET ?? "";
  if (!expected || !presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Applies a status pushed by the bridge (webhook). It is ignored for unknown sessions. */
export async function handleEdcWebhook(payload: BridgeStatusResponse & { sessionId: string }): Promise<EdcPaymentDto | null> {
  const payment = await prisma.edcPayment.findUnique({
    where: { externalSessionId: payload.sessionId },
  });
  if (!payment) return null;

  const updated = await applyTerminalState(payment, toTerminalState(payload));
  return toEdcPaymentDto(updated);
}
