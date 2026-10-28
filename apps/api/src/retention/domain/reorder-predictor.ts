import { addDays, daysBetween, isoDay } from './dates';
import { coefficientOfVariation, median } from './stats';

export type ReorderStatus = 'scheduled' | 'dueSoon' | 'overdue' | 'atRisk';
export type Confidence = 'high' | 'medium' | 'low';

export interface OrderPoint {
  date: Date;
  quantity?: number | null;
}

export interface ReorderPrediction {
  orderCount: number;
  cycleDays: number;
  lastOrderDate: Date;
  predictedNextDate: Date;
  daysUntilDue: number;
  status: ReorderStatus;
  confidence: Confidence;
  suggestedQuantity: number | null;
}

export interface ReorderOptions {
  /** "dueSoon" window before the predicted date. */
  dueSoonDays?: number;
  /** atRisk when days since last order > factor × cycle. */
  atRiskFactor?: number;
  /** Number of most recent intervals used. */
  maxIntervals?: number;
}

/**
 * Predicts the next order date of one SKU for one customer.
 * PPE is consumed on a cycle, so the median of recent intervals is a
 * robust estimate. Needs at least two distinct order dates.
 */
export function predictReorder(
  orders: OrderPoint[],
  today: Date,
  { dueSoonDays = 7, atRiskFactor = 1.5, maxIntervals = 6 }: ReorderOptions = {},
): ReorderPrediction | null {
  const byDay = new Map<string, { date: Date; qty: number }>();
  for (const o of orders) {
    const key = isoDay(o.date);
    const prev = byDay.get(key);
    byDay.set(key, { date: o.date, qty: (prev?.qty ?? 0) + Number(o.quantity ?? 0) });
  }
  if (byDay.size < 2) return null;

  const points = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);
  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) {
    intervals.push(daysBetween(points[i - 1].date, points[i].date));
  }
  const recent = intervals.slice(-maxIntervals);
  const cycleDays = Math.max(1, Math.round(median(recent)));

  const last = points[points.length - 1].date;
  const predicted = addDays(last, cycleDays);
  const daysUntilDue = daysBetween(today, predicted);
  const daysSinceLast = daysBetween(last, today);

  let status: ReorderStatus;
  if (daysSinceLast > atRiskFactor * cycleDays) status = 'atRisk';
  else if (daysUntilDue < 0) status = 'overdue';
  else if (daysUntilDue <= dueSoonDays) status = 'dueSoon';
  else status = 'scheduled';

  const quantities = points.map((p) => p.qty).filter((q) => q > 0);

  return {
    orderCount: points.length,
    cycleDays,
    lastOrderDate: last,
    predictedNextDate: predicted,
    daysUntilDue,
    status,
    confidence: confidenceOf(recent),
    suggestedQuantity: quantities.length ? median(quantities.slice(-3)) : null,
  };
}

function confidenceOf(intervals: number[]): Confidence {
  const cv = coefficientOfVariation(intervals);
  if (intervals.length >= 3 && cv <= 0.25) return 'high';
  if (intervals.length >= 2 && cv <= 0.5) return 'medium';
  return 'low';
}
