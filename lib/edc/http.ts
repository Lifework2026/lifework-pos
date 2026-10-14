import { apiError } from "@/lib/api";
import { EdcServiceError } from "@/lib/edc/service";
import { EdcUnavailableError } from "@/lib/edc/types";

/** Maps EDC service failures to HTTP responses. Unknown errors become 500 and are logged. */
export function edcErrorResponse(route: string, err: unknown): Response {
  if (err instanceof EdcServiceError) {
    return apiError(err.status, err.code, err.message);
  }
  if (err instanceof EdcUnavailableError) {
    return apiError(502, "EDC_UNAVAILABLE", err.message);
  }
  console.error(`[${route}]`, err);
  return apiError(500, "INTERNAL_ERROR", "Card terminal request failed. Please try again.");
}
