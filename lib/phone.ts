/** Phone numbers are stored as digits only, so lookups ignore dashes and spaces. Client-safe. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}
