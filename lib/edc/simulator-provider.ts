import { randomBytes, randomUUID } from "crypto";
import type { EdcProvider, EdcTerminalState } from "./types";

/**
 * Development-only terminal. It approves each payment after a short delay so
 * the checkout flow can be exercised without hardware. Blocked in production.
 */

const APPROVE_AFTER_MS = 4_000;

interface SimulatedSession {
  startedAt: number;
  cancelled: boolean;
  transactionRef: string;
}

// Kept on globalThis so sessions survive dev hot reloads.
const globalForSim = globalThis as unknown as { edcSimSessions?: Map<string, SimulatedSession> };
const sessions = globalForSim.edcSimSessions ?? new Map<string, SimulatedSession>();
globalForSim.edcSimSessions = sessions;

export class SimulatorEdcProvider implements EdcProvider {
  readonly mode = "SIMULATOR" as const;

  async start(): Promise<{ externalSessionId: string }> {
    const externalSessionId = randomUUID();
    sessions.set(externalSessionId, {
      startedAt: Date.now(),
      cancelled: false,
      transactionRef: `SIM${Date.now()}${randomBytes(3).toString("hex").toUpperCase()}`,
    });
    return { externalSessionId };
  }

  async poll(externalSessionId: string): Promise<EdcTerminalState> {
    const session = sessions.get(externalSessionId);
    if (!session) return { state: "DECLINED", reason: "Unknown terminal session." };
    if (session.cancelled) return { state: "CANCELLED" };
    if (Date.now() - session.startedAt < APPROVE_AFTER_MS) return { state: "PENDING" };

    return {
      state: "APPROVED",
      transactionRef: session.transactionRef,
      approvalCode: "SIM" + session.transactionRef.slice(-4),
      cardMask: "**** **** **** 4242",
    };
  }

  async cancel(externalSessionId: string): Promise<void> {
    const session = sessions.get(externalSessionId);
    if (session) session.cancelled = true;
  }
}
