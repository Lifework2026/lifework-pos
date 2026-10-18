/**
 * How the card terminal is used, decided from EDC_MODE. Pure, so the server, the till's mode route and the tests agree.
 *
 *   manual     the shop's own EDC machine, used on its own: the cashier keys the amount on the machine, then types the
 *              reference from the slip into the till. Nothing is sent to a terminal, so nothing can fail to connect.
 *   bridge     the amount is sent to a terminal bridge over HTTP and the answer comes back by polling or webhook. It needs the
 *              bridge address, token and webhook secret. EDC_MODE=bridge with any of them missing cannot work, so it is manual.
 *   simulator  a fake terminal for development. It is never allowed in production: there it falls back to manual.
 *
 * "manual" and "standalone" mean the same. A missing or unknown value is manual too, because that is the safe way to fail:
 * a till that asks for a slip reference cannot invent an approval.
 */
export type EdcMode = "manual" | "bridge" | "simulator";

export function resolveEdcMode(env: {
  EDC_MODE?: string;
  NODE_ENV?: string;
  EDC_BRIDGE_URL?: string;
  EDC_BRIDGE_TOKEN?: string;
  EDC_WEBHOOK_SECRET?: string;
}): EdcMode {
  const mode = (env.EDC_MODE ?? "").trim().toLowerCase();
  if (mode === "bridge") {
    const complete = [env.EDC_BRIDGE_URL, env.EDC_BRIDGE_TOKEN, env.EDC_WEBHOOK_SECRET].every((value) => !!value?.trim());
    return complete ? "bridge" : "manual";
  }
  if (mode === "simulator" && env.NODE_ENV !== "production") return "simulator";
  return "manual";
}
