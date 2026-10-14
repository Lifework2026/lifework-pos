import { Prisma } from "@prisma/client";
import type { ApiErrorBody } from "@/lib/pos-types";

/** Server-only helpers. Do not import from client components: they pull in Prisma at runtime. */

/** Formats a Prisma Decimal, number or string as a fixed 2dp string, e.g. "890.00". */
export function formatMoney(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export function apiError(
  status: number,
  error: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = { error, message, ...(details !== undefined ? { details } : {}) };
  return Response.json(body, { status });
}
