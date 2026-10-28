import { daysBetween, isoDay } from './dates';
import { median } from './stats';

export interface OrderAmountPoint {
  date: Date;
  amount: number;
}

export interface CustomerOrderStats {
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  daysSinceLastOrder: number | null;
  /** Median of the last 6 intervals between distinct order days. */
  orderCycleDays: number | null;
  revenueTotal: number;
  revenue12m: number;
  revenuePrev12m: number;
}

export interface CustomerStatsOptions {
  /**
   * Orders within this many days of the previous one count as one purchase
   * occasion (B2B customers often split one need into several POs).
   */
  mergeWindowDays?: number;
  /**
   * Cycles of the customer's regularly bought SKUs. When given, the customer
   * cycle is the shortest of them: the longest normal gap with no order at all.
   * More robust than order gaps when SKUs on different cycles interleave.
   */
  skuCycleDays?: number[];
}

export function computeCustomerStats(
  orders: OrderAmountPoint[],
  today: Date,
  { mergeWindowDays = 7, skuCycleDays = [] }: CustomerStatsOptions = {},
): CustomerOrderStats {
  const days = new Map<string, Date>();
  let revenueTotal = 0;
  let revenue12m = 0;
  let revenuePrev12m = 0;
  let orderCount = 0;

  for (const o of orders) {
    const age = daysBetween(o.date, today);
    if (age < 0) continue; // ignore future-dated rows
    orderCount++;
    days.set(isoDay(o.date), o.date);
    revenueTotal += o.amount;
    if (age < 365) revenue12m += o.amount;
    else if (age < 730) revenuePrev12m += o.amount;
  }

  const sorted = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, d]) => d);
  if (sorted.length === 0) {
    return {
      orderCount: 0,
      firstOrderAt: null,
      lastOrderAt: null,
      daysSinceLastOrder: null,
      orderCycleDays: null,
      revenueTotal,
      revenue12m,
      revenuePrev12m,
    };
  }

  // Start day of each purchase occasion.
  const occasions: Date[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) > mergeWindowDays) occasions.push(sorted[i]);
  }
  const intervals: number[] = [];
  for (let i = 1; i < occasions.length; i++) intervals.push(daysBetween(occasions[i - 1], occasions[i]));
  const last = sorted[sorted.length - 1];

  return {
    orderCount,
    firstOrderAt: sorted[0],
    lastOrderAt: last,
    daysSinceLastOrder: daysBetween(last, today),
    orderCycleDays: skuCycleDays.length
      ? Math.max(1, Math.round(Math.min(...skuCycleDays)))
      : intervals.length
        ? Math.max(1, Math.round(median(intervals.slice(-6))))
        : null,
    revenueTotal,
    revenue12m,
    revenuePrev12m,
  };
}
