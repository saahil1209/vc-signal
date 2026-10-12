// Date helpers. All dates are calendar dates as 'YYYY-MM-DD' strings.

export const WINDOW_DAYS = 30;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns the date as YYYY-MM-DD if it is a real calendar date, else null. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value.trim().slice(0, 10));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function windowStart(runDate: string): string {
  return addDays(runDate, -WINDOW_DAYS);
}

/** True if date is a valid date within [start, end] inclusive. */
export function inWindow(date: unknown, start: string, end: string): boolean {
  const d = parseIsoDate(date);
  return d !== null && d >= start && d <= end;
}
