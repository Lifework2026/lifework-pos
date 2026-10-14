/**
 * Types shared by the EDC layer and the POS client. Types only, so this file is
 * safe to import from client components.
 */

export type EdcMode = "BRIDGE" | "SIMULATOR" | "MANUAL";
export type EdcStatus = "PENDING" | "SUCCESS" | "CANCELLED" | "TIMED_OUT" | "FAILED";

export interface EdcStartRequest {
  requestId: string;
  /** Amount in satang (1 THB = 100), an integer, so the terminal never sees float rounding. */
  amountSatang: number;
  currency: "THB";
  reference: string;
  timeoutMs: number;
}

/** What a terminal reports for a payment session. */
export type EdcTerminalState =
  | { state: "PENDING" }
  | { state: "APPROVED"; transactionRef: string; approvalCode: string | null; cardMask: string | null }
  | { state: "DECLINED"; reason: string }
  | { state: "CANCELLED" }
  | { state: "TIMEOUT" };

/**
 * Transport to a card terminal. Implementations talk to a local bridge (HTTP,
 * IP socket or serial) or simulate one for development.
 */
export interface EdcProvider {
  readonly mode: "BRIDGE" | "SIMULATOR";
  start(request: EdcStartRequest): Promise<{ externalSessionId: string }>;
  poll(externalSessionId: string): Promise<EdcTerminalState>;
  cancel(externalSessionId: string): Promise<void>;
}

/** Thrown when the terminal or bridge cannot be reached. Callers can offer manual fallback. */
export class EdcUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdcUnavailableError";
  }
}

export interface EdcPaymentDto {
  id: string;
  mode: EdcMode;
  status: EdcStatus;
  amount: string;
  transactionRef: string | null;
  approvalCode: string | null;
  cardMask: string | null;
  failureReason: string | null;
  expiresAt: string;
  completedAt: string | null;
  orderId: string | null;
  /** True when the last poll could not reach the terminal. The payment is still pending. */
  terminalUnreachable: boolean;
}
