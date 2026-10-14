import { EdcUnavailableError, type EdcProvider, type EdcStartRequest, type EdcTerminalState } from "./types";

/**
 * Bridge contract, implemented by the local terminal bridge service:
 *   POST   {base}/v1/payments                 body: EdcStartRequest      -> { sessionId }
 *   GET    {base}/v1/payments/{sessionId}                                -> BridgeStatusResponse
 *   POST   {base}/v1/payments/{sessionId}/cancel                         -> 204
 * Every request carries "Authorization: Bearer <EDC_BRIDGE_TOKEN>".
 */

export interface BridgeConfig {
  baseUrl: string;
  token: string;
}

export interface BridgeStatusResponse {
  status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "TIMEOUT";
  transactionRef?: string;
  approvalCode?: string | null;
  cardMask?: string | null;
  reason?: string;
}

const REQUEST_TIMEOUT_MS = 5_000;

/** Maps a bridge status payload to the terminal state the service understands. */
export function toTerminalState(data: BridgeStatusResponse): EdcTerminalState {
  switch (data.status) {
    case "PENDING":
      return { state: "PENDING" };
    case "APPROVED":
      if (!data.transactionRef) {
        throw new EdcUnavailableError("EDC bridge reported an approval without a transaction reference.");
      }
      return {
        state: "APPROVED",
        transactionRef: data.transactionRef,
        approvalCode: data.approvalCode ?? null,
        cardMask: data.cardMask ?? null,
      };
    case "DECLINED":
      return { state: "DECLINED", reason: data.reason ?? "Card declined." };
    case "CANCELLED":
      return { state: "CANCELLED" };
    case "TIMEOUT":
      return { state: "TIMEOUT" };
    default:
      throw new EdcUnavailableError("EDC bridge returned an unknown status.");
  }
}

export class BridgeEdcProvider implements EdcProvider {
  readonly mode = "BRIDGE" as const;

  constructor(private readonly config: BridgeConfig) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      throw new EdcUnavailableError(`EDC bridge is unreachable (${reason}).`);
    }

    if (!res.ok) {
      throw new EdcUnavailableError(`EDC bridge responded with HTTP ${res.status}.`);
    }
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  async start(request: EdcStartRequest): Promise<{ externalSessionId: string }> {
    const data = await this.request<{ sessionId?: string }>("POST", "/v1/payments", request);
    if (!data?.sessionId) {
      throw new EdcUnavailableError("EDC bridge did not return a session id.");
    }
    return { externalSessionId: data.sessionId };
  }

  async poll(externalSessionId: string): Promise<EdcTerminalState> {
    const data = await this.request<BridgeStatusResponse>(
      "GET",
      `/v1/payments/${encodeURIComponent(externalSessionId)}`,
    );
    if (!data) throw new EdcUnavailableError("EDC bridge returned an empty status.");
    return toTerminalState(data);
  }

  async cancel(externalSessionId: string): Promise<void> {
    await this.request("POST", `/v1/payments/${encodeURIComponent(externalSessionId)}/cancel`);
  }
}
