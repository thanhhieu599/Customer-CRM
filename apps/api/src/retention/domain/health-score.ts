/**
 * Customer Health Score 0–100 (rule-based, explainable).
 *
 *   Order recency vs. the customer's own cycle   35
 *   12-month revenue trend                       20
 *   Service: open / SLA-breached tickets         20
 *   Payment: overdue receivable days (MISA)      15
 *   Engagement: interactions in the last 30 days 10
 *
 * Level: >= 70 HEALTHY, >= 40 WATCH, < 40 AT_RISK.
 * Override: a customer with a known cycle that missed 2+ cycles is AT_RISK
 * (score capped at 39), however good its past revenue was.
 * Weights are a starting point – calibrate after 2–3 months of real data.
 */
export type HealthLevel = 'HEALTHY' | 'WATCH' | 'AT_RISK';

export interface HealthInput {
  daysSinceLastOrder: number | null;
  orderCycleDays: number | null;
  revenue12m: number;
  revenuePrev12m: number;
  openTickets: number;
  breachedTickets: number;
  overdueDebtDays: number | null;
  /** Interactions (calls, visits, emails…) in the last 30 days. */
  recentActivities: number;
  /** At least one of them had a POSITIVE outcome. */
  recentPositive: boolean;
}

export interface HealthResult {
  score: number;
  level: HealthLevel;
  reasons: string[];
  breakdown: Record<'recency' | 'trend' | 'service' | 'payment' | 'engagement', number>;
}

/** Cycle assumed when a customer has a single order. */
export const DEFAULT_CYCLE_DAYS = 45;

export function calculateHealth(input: HealthInput): HealthResult {
  const reasons: string[] = [];
  const breakdown = {
    recency: recency(input, reasons),
    trend: trend(input, reasons),
    service: service(input, reasons),
    payment: payment(input, reasons),
    engagement: engagement(input, reasons),
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  let score = Math.round(Math.max(0, Math.min(100, total)));
  if (
    input.orderCycleDays &&
    input.daysSinceLastOrder !== null &&
    input.daysSinceLastOrder >= 2 * input.orderCycleDays &&
    score >= 40
  ) {
    score = 39;
    reasons.unshift('Đã bỏ lỡ từ 2 chu kỳ mua trở lên');
  }
  const level: HealthLevel = score >= 70 ? 'HEALTHY' : score >= 40 ? 'WATCH' : 'AT_RISK';
  return { score, level, reasons, breakdown: roundAll(breakdown) };
}

function recency(i: HealthInput, reasons: string[]): number {
  if (i.daysSinceLastOrder === null) {
    reasons.push('Chưa có lịch sử mua hàng');
    return 0;
  }
  const cycle = Math.max(1, i.orderCycleDays ?? DEFAULT_CYCLE_DAYS);
  const ratio = i.daysSinceLastOrder / cycle;
  if (ratio <= 1) return 35;
  reasons.push(`Quá chu kỳ mua: ${i.daysSinceLastOrder} ngày chưa có đơn (chu kỳ ≈${cycle} ngày)`);
  return ratio >= 2 ? 0 : 35 * (2 - ratio);
}

function trend(i: HealthInput, reasons: string[]): number {
  if (i.revenuePrev12m <= 0) {
    if (i.revenue12m > 0) return 16; // new customer this year – no baseline yet
    reasons.push('Không có doanh thu trong 12 tháng');
    return 0;
  }
  const growth = (i.revenue12m - i.revenuePrev12m) / i.revenuePrev12m;
  if (growth < 0) reasons.push(`Doanh thu 12 tháng giảm ${Math.round(-growth * 100)}% so với cùng kỳ`);
  if (growth >= 0.1) return 20;
  if (growth <= -0.3) return 0;
  return (20 * (growth + 0.3)) / 0.4;
}

function service(i: HealthInput, reasons: string[]): number {
  let points = i.openTickets <= 0 ? 20 : i.openTickets === 1 ? 12 : i.openTickets === 2 ? 6 : 0;
  if (i.openTickets > 0) reasons.push(`${i.openTickets} ticket/khiếu nại chưa giải quyết`);
  if (i.breachedTickets > 0) {
    reasons.push(`${i.breachedTickets} ticket quá SLA`);
    points -= 5 * i.breachedTickets;
  }
  return Math.max(0, points);
}

function payment(i: HealthInput, reasons: string[]): number {
  const d = i.overdueDebtDays;
  if (d === null || d <= 0) return 15;
  reasons.push(`Công nợ quá hạn ${d} ngày`);
  return d <= 15 ? 10 : d <= 30 ? 5 : 0;
}

function engagement(i: HealthInput, reasons: string[]): number {
  if (i.recentPositive) return 10;
  if (i.recentActivities > 0) return 5;
  reasons.push('Không có tương tác chăm sóc trong 30 ngày');
  return 0;
}

function roundAll<T extends Record<string, number>>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10])) as T;
}
