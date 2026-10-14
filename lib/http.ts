/**
 * Client-side JSON request with retries for transient failures (dropped connection, 502/503/504).
 * Client-safe. Aborts are rethrown so callers can ignore superseded requests.
 */

export type JsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; message: string | null; network: boolean };

const TRANSIENT_STATUSES = [502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: { signal?: AbortSignal; retries?: number } = {},
): Promise<JsonResult<T>> {
  const retries = options.retries ?? 2;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, cache: "no-store", signal: options.signal });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      return { ok: false, status: 0, code: "NETWORK", message: null, network: true };
    }

    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | T | null;
    if (res.ok && body !== null) {
      return { ok: true, data: body as T };
    }

    const errorBody = (body ?? {}) as { error?: string; message?: string };
    if (TRANSIENT_STATUSES.includes(res.status) && attempt < retries) {
      await sleep(300 * (attempt + 1));
      continue;
    }
    return {
      ok: false,
      status: res.status,
      code: errorBody.error ?? null,
      message: errorBody.message ?? null,
      network: false,
    };
  }

  return { ok: false, status: 0, code: "NETWORK", message: null, network: true };
}
