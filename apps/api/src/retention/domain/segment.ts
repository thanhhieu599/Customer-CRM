import { HealthLevel } from './health-score';

export type Segment = 'NEW' | 'REGULAR' | 'VIP' | 'AT_RISK' | 'DORMANT';

export interface SegmentInput {
  tier: string | null;
  revenue12m: number;
  daysSinceFirstOrder: number | null;
  daysSinceLastOrder: number | null;
  orderCycleDays: number | null;
  healthLevel: HealthLevel | null;
}

export interface SegmentOptions {
  /** 12-month revenue that makes a customer VIP (VND). */
  vipRevenue12m?: number;
  /** A customer is NEW for this many days after the first order. */
  newCustomerDays?: number;
  /** Minimum days without orders before DORMANT. */
  dormantMinDays?: number;
}

/**
 * One actionable segment per customer. Order matters: a VIP that stopped
 * buying is shown as AT_RISK / DORMANT, because that is what needs action.
 */
export function segmentOf(
  i: SegmentInput,
  { vipRevenue12m = 500_000_000, newCustomerDays = 90, dormantMinDays = 180 }: SegmentOptions = {},
): Segment {
  if (i.daysSinceLastOrder === null) return 'NEW';
  const dormantAfter = Math.max(dormantMinDays, 3 * (i.orderCycleDays ?? 0));
  if (i.daysSinceLastOrder > dormantAfter) return 'DORMANT';
  if (i.healthLevel === 'AT_RISK') return 'AT_RISK';
  if (i.tier === 'A' || i.revenue12m >= vipRevenue12m) return 'VIP';
  if (i.daysSinceFirstOrder !== null && i.daysSinceFirstOrder <= newCustomerDays) return 'NEW';
  return 'REGULAR';
}
