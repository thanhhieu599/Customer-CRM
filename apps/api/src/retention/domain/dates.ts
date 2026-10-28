/**
 * Day-level date helpers. Calendar dates are represented as JS Dates at
 * UTC midnight (this is how Prisma returns @db.Date columns).
 */
const DAY_MS = 86_400_000;

export function toDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Signed number of calendar days from `from` to `to`. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDay(to).getTime() - toDay(from).getTime()) / DAY_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(toDay(date).getTime() + days * DAY_MS);
}

/** Today's calendar date in the given IANA time zone, as UTC midnight. */
export function todayIn(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // YYYY-MM-DD
  return new Date(`${parts}T00:00:00.000Z`);
}

export function isoDay(date: Date): string {
  return toDay(date).toISOString().slice(0, 10);
}

/** Accepts YYYY-MM-DD or DD/MM/YYYY (MISA exports). Returns null if invalid. */
export function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}
