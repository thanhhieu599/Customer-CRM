import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessToday, startOfBusinessDay } from '../common/business-time';
import { AutomationRule, AutomationTrigger, Prisma, Priority, TaskType } from '../generated/prisma/client';
import { addDays, daysBetween, isoDay, toDay } from './domain/dates';
import { computeCustomerStats } from './domain/customer-stats';
import { calculateHealth } from './domain/health-score';
import { segmentOf } from './domain/segment';
import { DEFAULT_RULES } from './default-rules';
import { ReorderService } from './reorder.service';

/** A task an automation rule wants to create. */
interface Candidate {
  key: string; // idempotency key – one task per key, ever
  customerId: string | null;
  ticketId?: string;
  assigneeId: string | null;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  dueAt: Date;
  /** Higher = created first when maxTasksPerRun caps the run. */
  weight: number;
}

export interface RunSummary {
  customersScored: number;
  newlyAtRisk: number;
  autoClosedTasks: number;
  rules: Record<string, { candidates: number; created: number; skipped: number; failed: number }>;
}

const MANUAL_ACTIVITY_TYPES = ['CALL', 'EMAIL', 'ZALO', 'MEETING', 'VISIT', 'NOTE'] as const;
const OPEN_TICKET = ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER'] as const;
const OPEN_TASK = ['OPEN', 'IN_PROGRESS'] as const;
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

type Cfg = Record<string, unknown>;
const num = (cfg: Cfg, k: string, d: number) => (typeof cfg[k] === 'number' ? (cfg[k] as number) : d);

/** End of the business day (17:00 local), `days` from today. */
function dueAtDay(today: Date, days: number): Date {
  return new Date(startOfBusinessDay(today, days).getTime() + 17 * 3600 * 1000);
}

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đ`;
const vnDate = (d: Date) => isoDay(d).split('-').reverse().join('/');

/**
 * Retention engine: scores every customer, then turns rules into follow-up
 * tasks for the owner. Safe to run many times a day (idempotency keys).
 */
@Injectable()
export class RetentionEngine {
  private readonly logger = new Logger(RetentionEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reorder: ReorderService,
  ) {}

  async ensureRules(): Promise<void> {
    for (const r of DEFAULT_RULES) {
      await this.prisma.automationRule.upsert({
        where: { key: r.key },
        create: { ...r, config: r.config as Prisma.InputJsonValue },
        update: {},
      });
    }
  }

  // ─────────────────────────────── daily run ───────────────────────────────

  async runDaily(today = businessToday()): Promise<RunSummary> {
    await this.ensureRules();
    const rules = await this.prisma.automationRule.findMany({ where: { isActive: true } });
    const rule = (t: AutomationTrigger) => rules.find((r) => r.trigger === t);

    const summary: RunSummary = { customersScored: 0, newlyAtRisk: 0, autoClosedTasks: 0, rules: {} };
    const newlyAtRisk = await this.scoreCustomers(today, summary);
    summary.autoClosedTasks = await this.autoCloseConvertedTasks();

    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, ownerId: true, segment: true, lastOrderAt: true, orderCycleDays: true,
        orderCount: true, revenue12m: true, lastActivityAt: true, healthScore: true, healthReasons: true,
      },
    });
    const openTasks = await this.prisma.task.findMany({
      where: { status: { in: [...OPEN_TASK] }, source: 'AUTOMATION', customerId: { not: null } },
      select: { customerId: true, type: true },
    });
    // One open automated follow-up per customer at a time (ticket tasks aside):
    // a skipped candidate is not recorded, so it comes back once the task is closed.
    const hasOpen = new Set(openTasks.filter((t) => t.type !== 'TICKET').map((t) => t.customerId!));
    const touched = new Set<string>(); // max one automation task per customer per run

    // Order = priority when several rules match the same customer.
    const plan: [AutomationRule | undefined, () => Promise<Candidate[]> | Candidate[]][] = [
      [rule('HEALTH_AT_RISK'), () => this.healthAtRisk(customers.filter((c) => newlyAtRisk.has(c.id)), today, rule('HEALTH_AT_RISK')!)],
      [rule('NO_ORDER_FOR_CYCLE'), () => this.noOrderForCycle(customers, today, rule('NO_ORDER_FOR_CYCLE')!)],
      [rule('REORDER_DUE'), () => this.reorderDue(customers, today, rule('REORDER_DUE')!)],
      [rule('VIP_NO_CONTACT'), () => this.vipNoContact(customers, today, rule('VIP_NO_CONTACT')!)],
      [rule('POST_DELIVERY'), () => this.postDelivery(today, rule('POST_DELIVERY')!)],
    ];

    for (const [r, build] of plan) {
      if (!r) continue;
      const candidates = (await build()).filter(
        (c) => !c.customerId || (!touched.has(c.customerId) && !hasOpen.has(c.customerId)),
      );
      const stats = await this.createTasks(r, candidates);
      summary.rules[r.key] = stats.stats;
      stats.createdFor.forEach((id) => touched.add(id));
    }

    this.logger.log(`daily run: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** Recomputes stats, health score and segment for every customer. */
  private async scoreCustomers(today: Date, summary: RunSummary): Promise<Set<string>> {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [customers, orders, tickets, activities] = await Promise.all([
      this.prisma.customer.findMany({
        where: { deletedAt: null },
        select: { id: true, tier: true, healthLevel: true, overdueDebtDays: true },
      }),
      this.prisma.order.findMany({
        where: { status: { not: 'CANCELED' }, customer: { deletedAt: null } },
        select: { customerId: true, orderDate: true, totalAmount: true },
      }),
      this.prisma.ticket.findMany({
        where: { status: { in: [...OPEN_TICKET] } },
        select: { customerId: true, slaBreached: true },
      }),
      this.prisma.activity.findMany({
        where: { occurredAt: { gte: since30 }, type: { in: [...MANUAL_ACTIVITY_TYPES] } },
        select: { customerId: true, outcome: true },
      }),
    ]);

    const group = <T extends { customerId: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.customerId, [...(m.get(r.customerId) ?? []), r]);
      return m;
    };
    const ordersBy = group(orders);
    // Cycles of SKUs bought regularly (3+ times, last within 12 months) per customer.
    const forecasts = await this.reorder.forecastByCustomer(customers.map((c) => c.id), undefined, today);
    const skuCycles = (id: string) =>
      (forecasts.get(id) ?? [])
        .filter((f) => f.orderCount >= 3 && daysBetween(f.lastOrderDate, today) <= 365)
        .map((f) => f.cycleDays);
    const ticketsBy = group(tickets);
    const activitiesBy = group(activities);
    const newlyAtRisk = new Set<string>();
    const now = new Date();

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const c of customers) {
      const stats = computeCustomerStats(
        (ordersBy.get(c.id) ?? []).map((o) => ({ date: o.orderDate, amount: Number(o.totalAmount) })),
        today,
        { skuCycleDays: skuCycles(c.id) },
      );
      const t = ticketsBy.get(c.id) ?? [];
      const a = activitiesBy.get(c.id) ?? [];
      const health = calculateHealth({
        daysSinceLastOrder: stats.daysSinceLastOrder,
        orderCycleDays: stats.orderCycleDays,
        revenue12m: stats.revenue12m,
        revenuePrev12m: stats.revenuePrev12m,
        openTickets: t.length,
        breachedTickets: t.filter((x) => x.slaBreached).length,
        overdueDebtDays: c.overdueDebtDays,
        recentActivities: a.length,
        recentPositive: a.some((x) => x.outcome === 'POSITIVE'),
      });
      const segment = segmentOf({
        tier: c.tier,
        revenue12m: stats.revenue12m,
        daysSinceFirstOrder: stats.firstOrderAt ? daysBetween(stats.firstOrderAt, today) : null,
        daysSinceLastOrder: stats.daysSinceLastOrder,
        orderCycleDays: stats.orderCycleDays,
        healthLevel: health.level,
      });

      // Only customers with purchase history can "drop" into AT_RISK.
      if (health.level === 'AT_RISK' && c.healthLevel !== 'AT_RISK' && stats.orderCount > 0) newlyAtRisk.add(c.id);

      updates.push(
        this.prisma.customer.update({
          where: { id: c.id },
          data: {
            healthScore: health.score,
            healthLevel: health.level,
            healthReasons: { reasons: health.reasons, breakdown: health.breakdown },
            healthUpdatedAt: now,
            segment,
            orderCount: stats.orderCount,
            firstOrderAt: stats.firstOrderAt,
            lastOrderAt: stats.lastOrderAt,
            orderCycleDays: stats.orderCycleDays,
            revenueTotal: stats.revenueTotal.toFixed(2),
            revenue12m: stats.revenue12m.toFixed(2),
            revenuePrev12m: stats.revenuePrev12m.toFixed(2),
          },
        }),
      );
    }
    for (let i = 0; i < updates.length; i += 200) await this.prisma.$transaction(updates.slice(i, i + 200));

    summary.customersScored = customers.length;
    summary.newlyAtRisk = newlyAtRisk.size;
    return newlyAtRisk;
  }

  /** Win-back / reorder tasks are closed automatically once the customer orders again. */
  private async autoCloseConvertedTasks(): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: { status: { in: [...OPEN_TASK] }, source: 'AUTOMATION', type: { in: ['WIN_BACK', 'REORDER'] }, customerId: { not: null } },
      select: { id: true, customerId: true, createdAt: true },
    });
    let closed = 0;
    for (const t of tasks) {
      const order = await this.prisma.order.findFirst({
        where: { customerId: t.customerId!, status: { not: 'CANCELED' }, orderDate: { gte: toDay(t.createdAt) } },
        orderBy: { orderDate: 'asc' },
        select: { code: true, orderDate: true },
      });
      if (!order) continue;
      await this.prisma.task.update({
        where: { id: t.id },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          result: `Tự động đóng: khách đã đặt đơn ${order.code} ngày ${vnDate(order.orderDate)}`,
        },
      });
      closed++;
    }
    return closed;
  }

  // ─────────────────────────────── rules ───────────────────────────────

  private healthAtRisk(customers: CustomerRow[], today: Date, rule: AutomationRule): Candidate[] {
    const cfg = rule.config as Cfg;
    return customers.map((c) => {
      const reasons = ((c.healthReasons as { reasons?: string[] } | null)?.reasons ?? []).map((r) => `• ${r}`);
      return {
        key: `health-at-risk:${c.id}:${isoDay(today)}`,
        customerId: c.id,
        assigneeId: c.ownerId,
        title: `Khách nguy cơ rời bỏ: ${c.name} (điểm ${c.healthScore}/100)`,
        description:
          `Lý do:\n${reasons.join('\n') || '—'}\n\n` +
          'Việc cần làm trong 48 giờ: gọi Purchasing và EHS, xử lý dứt điểm khiếu nại/công nợ, ' +
          'hẹn gặp trực tiếp và đề xuất phương án giữ khách (giá, mẫu thử, dịch vụ).',
        type: 'WIN_BACK',
        priority: 'URGENT',
        dueAt: dueAtDay(today, num(cfg, 'dueInDays', 2)),
        weight: Number(c.revenue12m),
      };
    });
  }

  private noOrderForCycle(customers: CustomerRow[], today: Date, rule: AutomationRule): Candidate[] {
    const cfg = rule.config as Cfg;
    const result: Candidate[] = [];
    for (const c of customers) {
      if (!c.lastOrderAt) continue;
      const days = daysBetween(c.lastOrderAt, today);
      const cycle = c.orderCycleDays ?? num(cfg, 'fallbackCycleDays', 45);
      const threshold = Math.max(num(cfg, 'minDays', 21), Math.round(cycle * num(cfg, 'cycleMultiplier', 1.3)));
      if (days < threshold || days > num(cfg, 'maxDays', 365)) continue;
      result.push({
        key: `no-order:${c.id}:${isoDay(c.lastOrderAt)}`,
        customerId: c.id,
        assigneeId: c.ownerId,
        title: `Khách lâu chưa mua lại: ${c.name} (${days} ngày)`,
        description:
          `Chu kỳ mua thường lệ: ≈${cycle} ngày. Đơn gần nhất: ${vnDate(c.lastOrderAt)}.\n` +
          `Doanh thu 12 tháng: ${vnd(Number(c.revenue12m))}.\n\n` +
          'Việc cần làm: gọi hỏi nhu cầu nhập hàng tiếp theo, kiểm tra có đổi nhà cung cấp / giảm sản lượng / ' +
          'vấn đề chất lượng không, ghi lại kết quả vào CRM.',
        type: 'WIN_BACK',
        priority: days > 2 * cycle ? 'URGENT' : 'HIGH',
        dueAt: dueAtDay(today, num(cfg, 'dueInDays', 1)),
        weight: Number(c.revenue12m),
      });
    }
    return result;
  }

  private async reorderDue(customers: CustomerRow[], today: Date, rule: AutomationRule): Promise<Candidate[]> {
    const cfg = rule.config as Cfg;
    const minRank = CONFIDENCE_RANK[(cfg.minConfidence as keyof typeof CONFIDENCE_RANK) ?? 'medium'] ?? 1;
    const eligible = customers.filter((c) => c.orderCount >= 2);
    const forecasts = await this.reorder.forecastByCustomer(
      eligible.map((c) => c.id),
      { dueSoonDays: num(cfg, 'dueSoonDays', 7) },
      today,
    );
    const result: Candidate[] = [];
    for (const c of eligible) {
      const due = (forecasts.get(c.id) ?? []).filter(
        (f) => (f.status === 'dueSoon' || f.status === 'overdue') && CONFIDENCE_RANK[f.confidence] >= minRank,
      );
      if (!due.length) continue;
      const fingerprint = due.map((f) => `${f.sku}@${isoDay(f.predictedNextDate)}`).sort().join('|');
      const earliest = due.reduce((a, f) => (f.predictedNextDate < a ? f.predictedNextDate : a), due[0].predictedNextDate);
      result.push({
        key: `reorder:${c.id}:${createHash('sha1').update(fingerprint).digest('hex').slice(0, 16)}`,
        customerId: c.id,
        assigneeId: c.ownerId,
        title: `Nhắc đặt hàng lại: ${c.name} – ${due.length} mã hàng`,
        description:
          due
            .map(
              (f) =>
                `• ${f.productName} (${f.sku}): dự kiến ${vnDate(f.predictedNextDate)}, chu kỳ ≈${f.cycleDays} ngày, ` +
                `SL gợi ý ${f.suggestedQuantity ?? '—'} (độ tin cậy ${f.confidence})`,
            )
            .join('\n') +
          '\n\nViệc cần làm: liên hệ Purchasing xác nhận nhu cầu, gửi báo giá giữ giá, kiểm tra tồn kho để giao đúng hạn.',
        type: 'REORDER',
        priority: due.some((f) => f.status === 'overdue') ? 'URGENT' : 'HIGH',
        dueAt: dueAtDay(today, Math.max(num(cfg, 'dueInDays', 0), Math.min(daysBetween(today, earliest) - 2, 3))),
        weight: Number(c.revenue12m),
      });
    }
    return result;
  }

  private vipNoContact(customers: CustomerRow[], today: Date, rule: AutomationRule): Candidate[] {
    const cfg = rule.config as Cfg;
    const limit = num(cfg, 'days', 30);
    return customers
      .filter((c) => c.segment === 'VIP' && (!c.lastActivityAt || daysBetween(c.lastActivityAt, today) >= limit))
      .map((c) => ({
        key: `vip-no-contact:${c.id}:${c.lastActivityAt ? isoDay(c.lastActivityAt) : 'never'}`,
        customerId: c.id,
        assigneeId: c.ownerId,
        title: `Chăm sóc khách VIP: ${c.name}`,
        description:
          `Đã ${c.lastActivityAt ? `${daysBetween(c.lastActivityAt, today)} ngày` : 'lâu'} chưa có tương tác chăm sóc.\n\n` +
          'Gợi ý: gọi/thăm hỏi, cập nhật kế hoạch sản xuất & nhu cầu PPE quý tới, giới thiệu sản phẩm mới, hẹn QBR.',
        type: 'FOLLOW_UP' as TaskType,
        priority: 'NORMAL' as Priority,
        dueAt: dueAtDay(today, num(cfg, 'dueInDays', 2)),
        weight: Number(c.revenue12m),
      }));
  }

  private async postDelivery(today: Date, rule: AutomationRule): Promise<Candidate[]> {
    const cfg = rule.config as Cfg;
    const after = num(cfg, 'daysAfterDelivery', 3);
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'DELIVERED',
        deliveredAt: { lte: addDays(today, -after), gte: addDays(today, -after - num(cfg, 'lookbackDays', 7)) },
        totalAmount: { gte: num(cfg, 'minOrderAmount', 0) },
        customer: { deletedAt: null },
      },
      include: { customer: { select: { id: true, name: true, ownerId: true } } },
    });
    return orders.map((o) => ({
      key: `post-delivery:${o.id}`,
      customerId: o.customerId,
      assigneeId: o.customer.ownerId,
      title: `Hỏi thăm sau giao hàng: đơn ${o.code} – ${o.customer.name}`,
      description:
        `Giao ngày ${vnDate(o.deliveredAt!)}, giá trị ${vnd(Number(o.totalAmount))}.\n\n` +
        'Kiểm tra: hàng đúng chủng loại/size, chất lượng, chứng từ CO/CQ đủ chưa, người dùng cuối phản hồi thế nào; ' +
        'hỏi nhu cầu đơn tiếp theo.',
      type: 'POST_DELIVERY',
      priority: 'NORMAL',
      dueAt: dueAtDay(today, 1),
      weight: Number(o.totalAmount),
    }));
  }

  // ─────────────────────────────── SLA (every 15 min) ───────────────────────────────

  async runSlaCheck(now = new Date()): Promise<{ breached: number }> {
    await this.ensureRules();
    const rule = await this.prisma.automationRule.findUnique({ where: { key: 'ticket-sla-breach' } });
    if (!rule?.isActive) return { breached: 0 };

    const tickets = await this.prisma.ticket.findMany({
      where: { status: { in: [...OPEN_TICKET] }, firstResponseAt: null, slaBreached: false, slaDueAt: { lt: now } },
      include: { customer: { select: { name: true } } },
    });
    if (!tickets.length) return { breached: 0 };

    await this.prisma.ticket.updateMany({ where: { id: { in: tickets.map((t) => t.id) } }, data: { slaBreached: true } });

    const today = businessToday(now);
    await this.createTasks(
      rule,
      tickets.map((t) => ({
        key: `sla:${t.id}`,
        customerId: t.customerId,
        ticketId: t.id,
        assigneeId: t.assigneeId,
        title: `QUÁ SLA ticket #${t.number}: ${t.subject} – ${t.customer.name}`,
        description:
          'Ticket đã quá hạn phản hồi. Việc cần làm ngay: phản hồi khách, đưa biện pháp khắc phục tạm thời ' +
          '(containment) và hẹn lịch nộp báo cáo 8D.',
        type: 'TICKET',
        priority: 'URGENT',
        dueAt: dueAtDay(today, 0),
        weight: 0,
      })),
    );

    if ((rule.config as Cfg).notifyManagers !== false) {
      const managers = await this.prisma.user.findMany({ where: { isActive: true, role: { in: ['MANAGER', 'ADMIN'] } } });
      await this.prisma.notification.createMany({
        data: managers.flatMap((m) =>
          tickets.map((t) => ({
            userId: m.id,
            title: `Ticket #${t.number} quá SLA`,
            body: `${t.customer.name}: ${t.subject}`,
            link: `/tickets/${t.number}`,
          })),
        ),
      });
    }
    return { breached: tickets.length };
  }

  // ─────────────────────────────── task creation ───────────────────────────────

  /** Creates at most `maxTasksPerRun` tasks; each idempotency key only once. */
  private async createTasks(rule: AutomationRule, candidates: Candidate[]) {
    const stats = { candidates: candidates.length, created: 0, skipped: 0, failed: 0 };
    const createdFor: string[] = [];
    if (!candidates.length) return { stats, createdFor };

    const done = new Set(
      (
        await this.prisma.automationExecution.findMany({
          where: { idempotencyKey: { in: candidates.map((c) => c.key) } },
          select: { idempotencyKey: true },
        })
      ).map((e) => e.idempotencyKey),
    );
    const fresh = candidates.filter((c) => !done.has(c.key)).sort((a, b) => b.weight - a.weight);
    stats.skipped = candidates.length - fresh.length;
    const max = num(rule.config as Cfg, 'maxTasksPerRun', 1000);

    for (const c of fresh.slice(0, max)) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const task = await tx.task.create({
            data: {
              title: c.title.slice(0, 250),
              description: c.description,
              type: c.type,
              priority: c.priority,
              dueAt: c.dueAt,
              source: 'AUTOMATION',
              customerId: c.customerId,
              ticketId: c.ticketId ?? null,
              assigneeId: c.assigneeId,
            },
          });
          // Unique key: a concurrent run makes this throw and rolls the task back.
          await tx.automationExecution.create({
            data: { ruleId: rule.id, idempotencyKey: c.key, status: 'SUCCESS', customerId: c.customerId, taskId: task.id },
          });
        });
        stats.created++;
        if (c.customerId) createdFor.push(c.customerId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          stats.skipped++;
          continue;
        }
        stats.failed++;
        this.logger.error(`rule ${rule.key} failed for ${c.key}: ${(e as Error).message}`);
        await this.prisma.automationExecution
          .create({
            data: {
              ruleId: rule.id,
              idempotencyKey: `failed:${c.key}:${Date.now()}`,
              status: 'FAILED',
              customerId: c.customerId,
              error: (e as Error).message.slice(0, 2000),
            },
          })
          .catch(() => undefined);
      }
    }
    // Capped candidates are not recorded, so they are retried on the next run.
    return { stats, createdFor };
  }
}

type CustomerRow = {
  id: string;
  name: string;
  ownerId: string | null;
  segment: string;
  lastOrderAt: Date | null;
  orderCycleDays: number | null;
  orderCount: number;
  revenue12m: Prisma.Decimal;
  lastActivityAt: Date | null;
  healthScore: number | null;
  healthReasons: Prisma.JsonValue;
};
