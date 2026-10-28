import { addDays, daysBetween, parseDay, todayIn } from './dates';
import { predictReorder } from './reorder-predictor';
import { computeCustomerStats } from './customer-stats';
import { calculateHealth, HealthInput } from './health-score';
import { segmentOf } from './segment';
import { slaDueAt } from './sla';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('dates', () => {
  it('parses ISO and Vietnamese DD/MM/YYYY formats', () => {
    expect(parseDay('2026-03-05')).toEqual(d('2026-03-05'));
    expect(parseDay('05/03/2026')).toEqual(d('2026-03-05'));
    expect(parseDay('31/02/2026')).toBeNull();
    expect(parseDay('abc')).toBeNull();
  });

  it('computes today in Vietnam time, not UTC', () => {
    // 2026-10-27 18:30 UTC is already 2026-10-28 01:30 in Hanoi.
    expect(todayIn('Asia/Ho_Chi_Minh', new Date('2026-10-27T18:30:00Z'))).toEqual(d('2026-10-28'));
  });

  it('counts signed calendar days', () => {
    expect(daysBetween(d('2026-01-01'), d('2026-01-31'))).toBe(30);
    expect(daysBetween(d('2026-01-31'), d('2026-01-01'))).toBe(-30);
    expect(addDays(d('2026-12-30'), 3)).toEqual(d('2027-01-02'));
  });
});

describe('predictReorder', () => {
  const monthly = ['2026-05-01', '2026-05-29', '2026-06-27', '2026-07-26', '2026-08-24'].map((s) => ({
    date: d(s),
    quantity: 100,
  }));

  it('needs at least two distinct order days', () => {
    expect(predictReorder([{ date: d('2026-01-01') }], d('2026-02-01'))).toBeNull();
    expect(predictReorder([{ date: d('2026-01-01') }, { date: d('2026-01-01') }], d('2026-02-01'))).toBeNull();
  });

  it('predicts the next date from the median cycle with high confidence', () => {
    const p = predictReorder(monthly, d('2026-09-01'))!;
    expect(p.cycleDays).toBe(29);
    expect(p.predictedNextDate).toEqual(d('2026-09-22'));
    expect(p.daysUntilDue).toBe(21);
    expect(p.status).toBe('scheduled');
    expect(p.confidence).toBe('high');
    expect(p.suggestedQuantity).toBe(100);
  });

  it('flags dueSoon, overdue and atRisk', () => {
    expect(predictReorder(monthly, d('2026-09-18'))!.status).toBe('dueSoon');
    expect(predictReorder(monthly, d('2026-09-25'))!.status).toBe('overdue');
    // 45 days since last order > 1.5 × 29
    expect(predictReorder(monthly, d('2026-10-08'))!.status).toBe('atRisk');
  });

  it('is robust to one outlier interval and merges same-day orders', () => {
    const orders = [
      { date: d('2026-01-01'), quantity: 50 },
      { date: d('2026-01-01'), quantity: 50 },
      { date: d('2026-01-31'), quantity: 100 },
      { date: d('2026-03-02'), quantity: 100 },
      { date: d('2026-06-30'), quantity: 300 }, // 120-day gap (outlier)
      { date: d('2026-07-30'), quantity: 100 },
    ];
    const p = predictReorder(orders, d('2026-08-01'))!;
    expect(p.orderCount).toBe(5);
    expect(p.cycleDays).toBe(30);
    expect(p.confidence).toBe('low');
  });
});

describe('computeCustomerStats', () => {
  it('splits revenue into last 12 months and the 12 months before', () => {
    const s = computeCustomerStats(
      [
        { date: d('2024-10-01'), amount: 100 }, // > 730 days: total only
        { date: d('2025-06-01'), amount: 200 }, // prev 12m
        { date: d('2026-03-01'), amount: 300 }, // last 12m
        { date: d('2026-04-01'), amount: 400 }, // last 12m
        { date: d('2027-01-01'), amount: 999 }, // future: ignored
      ],
      d('2026-10-28'),
    );
    expect(s.orderCount).toBe(4);
    expect(s.revenueTotal).toBe(1000);
    expect(s.revenue12m).toBe(700);
    expect(s.revenuePrev12m).toBe(200);
    expect(s.lastOrderAt).toEqual(d('2026-04-01'));
    expect(s.daysSinceLastOrder).toBe(210);
  });

  it('handles customers without orders', () => {
    const s = computeCustomerStats([], d('2026-10-28'));
    expect(s.lastOrderAt).toBeNull();
    expect(s.orderCycleDays).toBeNull();
  });
});

describe('calculateHealth', () => {
  const healthy: HealthInput = {
    daysSinceLastOrder: 10,
    orderCycleDays: 30,
    revenue12m: 1_200,
    revenuePrev12m: 1_000,
    openTickets: 0,
    breachedTickets: 0,
    overdueDebtDays: 0,
    recentActivities: 2,
    recentPositive: true,
  };

  it('gives 100 to a perfect customer', () => {
    const r = calculateHealth(healthy);
    expect(r.score).toBe(100);
    expect(r.level).toBe('HEALTHY');
    expect(r.reasons).toEqual([]);
  });

  it('drops to AT_RISK with explainable reasons', () => {
    const r = calculateHealth({
      ...healthy,
      daysSinceLastOrder: 65, // 2.17 × cycle → 0
      revenue12m: 600, // -40% → 0
      openTickets: 1,
      breachedTickets: 1, // 12 - 5 = 7
      overdueDebtDays: 20, // 5
      recentActivities: 0,
      recentPositive: false, // 0
    });
    expect(r.score).toBe(12);
    expect(r.level).toBe('AT_RISK');
    expect(r.reasons).toHaveLength(6);
    expect(r.reasons[0]).toContain('65 ngày');
  });

  it('scores a mid-way customer as WATCH', () => {
    const r = calculateHealth({ ...healthy, daysSinceLastOrder: 45, revenue12m: 900, recentPositive: false });
    // recency 35×0.5=17.5, trend 20×0.2/0.4=10, service 20, payment 15, engagement 5
    expect(r.score).toBe(68);
    expect(r.level).toBe('WATCH');
  });
});

describe('segmentOf', () => {
  const base = {
    tier: null,
    revenue12m: 10_000_000,
    daysSinceFirstOrder: 400,
    daysSinceLastOrder: 20,
    orderCycleDays: 30,
    healthLevel: 'HEALTHY' as const,
  };

  it('classifies customers in priority order', () => {
    expect(segmentOf({ ...base, daysSinceLastOrder: null })).toBe('NEW');
    expect(segmentOf({ ...base, daysSinceLastOrder: 200 })).toBe('DORMANT');
    expect(segmentOf({ ...base, tier: 'A', healthLevel: 'AT_RISK' })).toBe('AT_RISK');
    expect(segmentOf({ ...base, revenue12m: 600_000_000 })).toBe('VIP');
    expect(segmentOf({ ...base, daysSinceFirstOrder: 30 })).toBe('NEW');
    expect(segmentOf(base)).toBe('REGULAR');
  });

  it('scales the dormant threshold with long cycles (e.g. safety shoes yearly)', () => {
    expect(segmentOf({ ...base, orderCycleDays: 120, daysSinceLastOrder: 300 })).toBe('REGULAR');
  });
});

describe('slaDueAt', () => {
  it('uses hours by priority', () => {
    const t = new Date('2026-10-28T01:00:00Z');
    expect(slaDueAt(t, 'URGENT').toISOString()).toBe('2026-10-28T05:00:00.000Z');
    expect(slaDueAt(t).toISOString()).toBe('2026-10-29T01:00:00.000Z');
  });
});

describe('customer cycle with split POs', () => {
  it('merges orders a few days apart into one purchase occasion', () => {
    // Gloves on day 0, wipes on day 5 – every 30 days.
    const orders = [0, 5, 30, 35, 60, 65, 90, 95].map((n) => ({ date: addDays(d('2026-01-01'), n), amount: 1 }));
    const s = computeCustomerStats(orders, d('2026-04-10'));
    expect(s.orderCycleDays).toBe(30);
    expect(s.lastOrderAt).toEqual(addDays(d('2026-01-01'), 95));
  });
});

describe('health override', () => {
  it('marks a big customer that missed 2 cycles as AT_RISK', () => {
    const r = calculateHealth({
      daysSinceLastOrder: 82,
      orderCycleDays: 28,
      revenue12m: 1_090,
      revenuePrev12m: 1_000,
      openTickets: 0,
      breachedTickets: 0,
      overdueDebtDays: 0,
      recentActivities: 1,
      recentPositive: true,
    });
    expect(r.level).toBe('AT_RISK');
    expect(r.score).toBe(39);
    expect(r.reasons[0]).toBe('Đã bỏ lỡ từ 2 chu kỳ mua trở lên');
  });
});

describe('customer cycle from SKU cycles', () => {
  it('uses the shortest regular SKU cycle when interleaved SKUs split the order gaps', () => {
    const orders = ['2026-04-12', '2026-05-12', '2026-05-29', '2026-06-09', '2026-07-08', '2026-07-23', '2026-08-05'].map(
      (s) => ({ date: d(s), amount: 1 }),
    );
    expect(computeCustomerStats(orders, d('2026-10-28')).orderCycleDays).toBeLessThan(20);
    expect(computeCustomerStats(orders, d('2026-10-28'), { skuCycleDays: [28, 56] }).orderCycleDays).toBe(28);
  });
});
