import { addDays, todayIn } from '../retention/domain/dates';

export const BUSINESS_TZ = process.env.TZ_BUSINESS ?? 'Asia/Ho_Chi_Minh';

/** Today's business calendar date (UTC midnight representation). */
export function businessToday(now = new Date()): Date {
  return todayIn(BUSINESS_TZ, now);
}

/** Offset of the business time zone from UTC at `at`, in ms (UTC+7 → 25 200 000). */
export function businessOffsetMs(at = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Real instant at which the business day `day` (+offsetDays) starts. */
export function startOfBusinessDay(day = businessToday(), offsetDays = 0): Date {
  const d = addDays(day, offsetDays);
  return new Date(d.getTime() - businessOffsetMs(d));
}
