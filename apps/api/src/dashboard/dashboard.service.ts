import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, seesAll } from '../common/current-user';
import { businessToday, startOfBusinessDay } from '../common/business-time';
import { addDays, daysBetween, isoDay } from '../retention/domain/dates';

const OPEN_TASK = ['OPEN', 'IN_PROGRESS'] as const;
const pct = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null);

/**
 * KPI definitions (kept explicit so numbers can be audited):
 *  - taskCompletionRate: tasks due in the period that are DONE / all tasks due in the period (excl. canceled)
 *  - overdueFollowUpRate: open tasks past due / all open tasks
 *  - firstResponseHours: average hours from ticket creation to first reply (tickets created in period)
 *  - ticketSlaCompliance: tickets created in period answered before SLA / tickets answered or breached
 *  - repeatPurchaseRate: customers who bought in the 12 months before the period AND bought again in it
 *                        / customers who bought in those 12 months
 *  - reactivationRate: customers who ordered in the period after a gap > 180 days
 *                      / (those + customers currently DORMANT)
 *  - careConversionRate: win-back / reorder tasks created in the period followed by an order within 14 days
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser, periodDays = 30) {
    const all = seesAll(user);
    const today = businessToday();
    const periodStartDay = addDays(today, -periodDays + 1);
    const periodStart = startOfBusinessDay(periodStartDay);
    const now = new Date();
    const customerWhere = all ? { deletedAt: null } : { deletedAt: null, ownerId: user.id };
    const taskWhere = all ? {} : { assigneeId: user.id };

    const [
      openTasks,
      overdueTasks,
      dueInPeriod,
      doneInPeriod,
      customersNeedingCare,
      segments,
      healthLevels,
      tickets,
      orders,
      careTasks,
      todayTasks,
      agents,
    ] = await Promise.all([
      this.prisma.task.count({ where: { ...taskWhere, status: { in: [...OPEN_TASK] } } }),
      this.prisma.task.count({ where: { ...taskWhere, status: { in: [...OPEN_TASK] }, dueAt: { lt: now } } }),
      this.prisma.task.count({ where: { ...taskWhere, status: { not: 'CANCELED' }, dueAt: { gte: periodStart, lt: now } } }),
      this.prisma.task.count({ where: { ...taskWhere, status: 'DONE', dueAt: { gte: periodStart, lt: now } } }),
      this.prisma.customer.count({
        where: { ...customerWhere, tasks: { some: { status: { in: [...OPEN_TASK] }, dueAt: { lt: startOfBusinessDay(today, 1) } } } },
      }),
      this.prisma.customer.groupBy({ by: ['segment'], where: customerWhere, _count: true }),
      this.prisma.customer.groupBy({ by: ['healthLevel'], where: customerWhere, _count: true }),
      this.prisma.ticket.findMany({
        where: { createdAt: { gte: periodStart }, customer: customerWhere },
        select: { createdAt: true, firstResponseAt: true, slaDueAt: true, slaBreached: true },
      }),
      this.prisma.order.findMany({
        where: { status: { not: 'CANCELED' }, orderDate: { gte: addDays(today, -periodDays - 400 - 180) }, customer: customerWhere },
        select: { customerId: true, orderDate: true, totalAmount: true },
        orderBy: { orderDate: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { ...taskWhere, source: 'AUTOMATION', type: { in: ['WIN_BACK', 'REORDER'] }, createdAt: { gte: periodStart } },
        select: { customerId: true, createdAt: true },
      }),
      this.prisma.task.findMany({
        where: { assigneeId: user.id, status: { in: [...OPEN_TASK] }, dueAt: { lt: startOfBusinessDay(today, 1) } },
        orderBy: [{ dueAt: 'asc' }],
        take: 15,
        include: { customer: { select: { id: true, name: true, segment: true, healthScore: true } } },
      }),
      all ? this.agentTable(periodStart, now) : Promise.resolve([]),
    ]);

    // Tickets
    const answered = tickets.filter((t) => t.firstResponseAt);
    const responseHours = answered.map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 3_600_000);
    const withinSla = answered.filter((t) => t.firstResponseAt! <= t.slaDueAt).length;
    const slaDenominator = answered.length + tickets.filter((t) => !t.firstResponseAt && (t.slaBreached || t.slaDueAt < now)).length;

    // Orders
    const ordersByCustomer = new Map<string, Date[]>();
    for (const o of orders) ordersByCustomer.set(o.customerId, [...(ordersByCustomer.get(o.customerId) ?? []), o.orderDate]);
    const repeat = this.repeatRate(ordersByCustomer, periodStartDay, today);
    const repeatRevenue = orders
      .filter((o) => o.orderDate >= periodStartDay && (ordersByCustomer.get(o.customerId) ?? [])[0] < periodStartDay)
      .reduce((a, o) => a + Number(o.totalAmount), 0);

    let reactivated = 0;
    for (const dates of ordersByCustomer.values()) {
      const idx = dates.findIndex((d) => d >= periodStartDay);
      if (idx > 0 && daysBetween(dates[idx - 1], dates[idx]) > 180) reactivated++;
    }
    const dormant = segments.find((s) => s.segment === 'DORMANT')?._count ?? 0;

    const converted = careTasks.filter((t) =>
      (ordersByCustomer.get(t.customerId!) ?? []).some((d) => {
        const gap = daysBetween(t.createdAt, d);
        return gap >= 0 && gap <= 14;
      }),
    ).length;

    const trend = Array.from({ length: 6 }, (_, i) => {
      const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5 + i, 1));
      const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
      const r = this.repeatRate(ordersByCustomer, monthStart, monthEnd < today ? monthEnd : today);
      return { month: isoDay(monthStart).slice(0, 7), repeatPurchaseRate: r.rate, eligible: r.eligible };
    });

    return {
      scope: all ? 'team' : 'me',
      periodDays,
      kpis: {
        customersNeedingCare,
        openTasks,
        overdueTasks,
        taskCompletionRate: pct(doneInPeriod, dueInPeriod),
        overdueFollowUpRate: pct(overdueTasks, openTasks),
        firstResponseHours: responseHours.length
          ? Math.round((10 * responseHours.reduce((a, b) => a + b, 0)) / responseHours.length) / 10
          : null,
        ticketSlaCompliance: pct(withinSla, slaDenominator),
        ticketsInPeriod: tickets.length,
        repeatPurchaseRate: repeat.rate,
        repeatPurchaseRevenue: Math.round(repeatRevenue),
        reactivationRate: pct(reactivated, reactivated + dormant),
        careConversionRate: pct(converted, careTasks.length),
        careTasksInPeriod: careTasks.length,
      },
      segments: Object.fromEntries(segments.map((s) => [s.segment, s._count])),
      health: Object.fromEntries(healthLevels.map((h) => [h.healthLevel ?? 'UNSCORED', h._count])),
      repeatPurchaseTrend: trend,
      todayTasks,
      agents,
    };
  }

  /** Customers who bought in the 365 days before `from` and again in [from, to]. */
  private repeatRate(byCustomer: Map<string, Date[]>, from: Date, to: Date) {
    const lookback = addDays(from, -365);
    let eligible = 0;
    let repeated = 0;
    for (const dates of byCustomer.values()) {
      if (!dates.some((d) => d >= lookback && d < from)) continue;
      eligible++;
      if (dates.some((d) => d >= from && d <= to)) repeated++;
    }
    return { rate: pct(repeated, eligible), eligible };
  }

  /** "Which agent is missing customers?" – per-user workload and follow-through. */
  private async agentTable(periodStart: Date, now: Date) {
    const users = await this.prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true } });
    return Promise.all(
      users.map(async (u) => {
        const [open, overdue, done, customers, atRisk, noTouch] = await Promise.all([
          this.prisma.task.count({ where: { assigneeId: u.id, status: { in: [...OPEN_TASK] } } }),
          this.prisma.task.count({ where: { assigneeId: u.id, status: { in: [...OPEN_TASK] }, dueAt: { lt: now } } }),
          this.prisma.task.count({ where: { assigneeId: u.id, status: 'DONE', completedAt: { gte: periodStart } } }),
          this.prisma.customer.count({ where: { ownerId: u.id, deletedAt: null } }),
          this.prisma.customer.count({ where: { ownerId: u.id, deletedAt: null, segment: { in: ['AT_RISK', 'DORMANT'] } } }),
          this.prisma.customer.count({
            where: {
              ownerId: u.id,
              deletedAt: null,
              segment: { in: ['VIP', 'AT_RISK'] },
              OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }],
            },
          }),
        ]);
        return { user: u, openTasks: open, overdueTasks: overdue, doneInPeriod: done, customers, atRiskCustomers: atRisk, keyCustomersNoContact30d: noTouch };
      }),
    ).then((rows) => rows.filter((r) => r.customers > 0 || r.openTasks > 0).sort((a, b) => b.overdueTasks - a.overdueTasks));
  }
}
