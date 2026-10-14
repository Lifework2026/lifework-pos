/**
 * Store-time helpers. The store trades in Thailand (UTC+7, no daylight saving),
 * so day boundaries are fixed offsets and "today" is the Bangkok calendar date.
 */

const STORE_TIMEZONE = "Asia/Bangkok";
const STORE_OFFSET = "+07:00";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date of `date` in store time, formatted YYYY-MM-DD. */
export function bangkokYmd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isYmd(value: string | undefined | null): value is string {
  return !!value && YMD_PATTERN.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/** Half-open UTC range [start, end) covering one store-time calendar day. */
export function bangkokDayRange(ymd: string): { start: Date; end: Date } {
  const start = new Date(`${ymd}T00:00:00${STORE_OFFSET}`);
  return { start, end: new Date(start.getTime() + ONE_DAY_MS) };
}

export function formatBangkokDateTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: STORE_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Hour of day (0-23) in store time. */
export function bangkokHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: STORE_TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(date),
  );
}
