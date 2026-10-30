import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AuthUser, seesAll } from '../common/current-user';
import { atomic } from '../common/transaction';
import { customerScope } from '../customers/customer-access';
import { businessToday, startOfBusinessDay } from '../common/business-time';
import { BulkCustomersDto, MergeCustomersDto, MergePreviewDto, SaveFilterDto } from './workspace.dto';
import { duplicatePairs, duplicateReasons, normalizeTax } from './duplicates';
import { computeCustomerStats } from '../retention/domain/customer-stats';
import { calculateHealth } from '../retention/domain/health-score';
import { segmentOf } from '../retention/domain/segment';
import { daysBetween } from '../retention/domain/dates';
import { forecastRows } from '../retention/reorder.service';
@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}
  async filters(user: AuthUser) {
    return this.prisma.savedFilter.findMany({
      where: { userId: user.id, resource: 'customers' },
      orderBy: { name: 'asc' },
    });
  }
  async saveFilter(user: AuthUser, dto: SaveFilterDto) {
    if (!dto.filters || !dto.name.trim()) throw new BadRequestException('Thiếu tên hoặc bộ lọc');
    const { page, pageSize, ...filters } = dto.filters;
    return this.prisma.savedFilter.upsert({
      where: { userId_resource_name: { userId: user.id, resource: 'customers', name: dto.name.trim() } },
      create: {
        userId: user.id,
        resource: 'customers',
        name: dto.name.trim(),
        filters: filters as Prisma.InputJsonValue,
      },
      update: { filters: filters as Prisma.InputJsonValue },
    });
  }
  async removeFilter(user: AuthUser, id: string) {
    const result = await this.prisma.savedFilter.deleteMany({ where: { id, userId: user.id } });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }
  async bulk(user: AuthUser, dto: BulkCustomersDto) {
    if (dto.action === 'assign' && !seesAll(user))
      throw new ForbiddenException('Chỉ quản lý được chuyển người phụ trách');
    if (dto.action === 'assign' && !dto.assigneeId) throw new BadRequestException('Chọn người phụ trách');
    if (dto.action === 'tag' && !dto.tags?.some((t) => t.trim())) throw new BadRequestException('Nhập ít nhất một tag');
    if (dto.action === 'task' && ((dto.title?.trim().length ?? 0) < 3 || !dto.dueAt))
      throw new BadRequestException('Nhập tiêu đề và hạn công việc');
    if (dto.action === 'task' && !seesAll(user) && dto.assigneeId && dto.assigneeId !== user.id)
      throw new ForbiddenException('Nhân viên chỉ tự giao việc');
    return atomic(this.prisma, async (tx) => {
      const customers = await tx.customer.findMany({ where: { id: { in: dto.ids }, ...customerScope(user) } });
      if (customers.length !== dto.ids.length)
        throw new ForbiddenException('Danh sách chứa khách không có quyền truy cập hoặc đã xóa');
      if (dto.assigneeId && !(await tx.user.findFirst({ where: { id: dto.assigneeId, isActive: true } })))
        throw new BadRequestException('Người phụ trách không hoạt động');
      if (dto.action === 'assign')
        await tx.customer.updateMany({ where: { id: { in: dto.ids } }, data: { ownerId: dto.assigneeId } });
      if (dto.action === 'tag')
        for (const name of [...new Set(dto.tags!.map((t) => t.trim()).filter(Boolean))]) {
          const tag = await tx.customerTag.upsert({ where: { name }, create: { name }, update: {} });
          await tx.customerTagRelation.createMany({
            data: dto.ids.map((customerId) => ({ customerId, tagId: tag.id })),
            skipDuplicates: true,
          });
        }
      if (dto.action === 'task')
        await tx.task.createMany({
          data: customers.map((c) => ({
            customerId: c.id,
            title: dto.title!.trim(),
            dueAt: new Date(dto.dueAt!),
            createdById: user.id,
            assigneeId: dto.assigneeId ?? (seesAll(user) ? (c.ownerId ?? user.id) : user.id),
          })),
        });
      await tx.activity.createMany({
        data: customers.map((c) => ({
          customerId: c.id,
          userId: user.id,
          type: 'STATUS_CHANGE' as const,
          content:
            dto.action === 'assign'
              ? 'Chuyển người phụ trách hàng loạt'
              : dto.action === 'tag'
                ? `Thêm tag: ${dto.tags!.join(', ')}`
                : `Giao việc: ${dto.title}`,
        })),
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: `bulk.${dto.action}`,
          entityType: 'Customer',
          changes: dto as unknown as Prisma.InputJsonValue,
        },
      });
      return { count: customers.length };
    });
  }
  async day(user: AuthUser) {
    const open = ['OPEN', 'IN_PROGRESS'] as const;
    const scope = customerScope(user),
      end = startOfBusinessDay(undefined, 1),
      now = new Date();
    const [tasks, quotes, opportunities, tickets] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          status: { in: [...open] },
          dueAt: { lt: end },
          OR: [
            { assigneeId: user.id, OR: [{ customerId: null }, { customer: { deletedAt: null } }] },
            { customer: { ...scope, ownerId: user.id } },
          ],
        },
        include: { customer: { select: { id: true, name: true } }, quote: { select: { opportunityId: true } } },
        orderBy: { dueAt: 'asc' },
        take: 100,
      }),
      this.prisma.quote.findMany({
        where: {
          status: 'SENT',
          followUpAt: { lt: end },
          opportunity: { customer: { ...scope, ownerId: user.id }, stage: { notIn: ['WON', 'LOST'] } },
        },
        include: { opportunity: { select: { id: true, title: true, customer: { select: { name: true } } } } },
        orderBy: { followUpAt: 'asc' },
        take: 100,
      }),
      this.prisma.opportunity.findMany({
        where: {
          customer: { ...scope, ownerId: user.id },
          stage: { notIn: ['WON', 'LOST'] },
          nextActionAt: { lt: end },
        },
        include: { customer: { select: { name: true } } },
        orderBy: { nextActionAt: 'asc' },
        take: 100,
      }),
      this.prisma.ticket.findMany({
        where: {
          status: { notIn: ['RESOLVED', 'CLOSED'] },
          slaDueAt: { lt: end },
          customer: scope,
          OR: [{ assigneeId: user.id }, { customer: { ownerId: user.id } }],
        },
        include: { customer: { select: { name: true } } },
        orderBy: { slaDueAt: 'asc' },
        take: 100,
      }),
    ]);
    return { tasks, quotes, opportunities, tickets, asOf: now, limitPerSection: 100 };
  }
  async duplicates(user: AuthUser) {
    this.manager(user);
    // Bound the scan and explicitly report coverage instead of implying a complete scan.
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
        take: 10000,
        select: { id: true, code: true, name: true, taxCode: true, phone: true, email: true, updatedAt: true },
      }),
      this.prisma.customer.count({ where: { deletedAt: null } }),
    ]);
    return {
      items: duplicatePairs(customers),
      scanned: customers.length,
      total,
      truncated: total > customers.length,
      pairLimit: 100,
    };
  }
  async preview(user: AuthUser, dto: MergePreviewDto) {
    this.manager(user);
    return atomic(this.prisma, (tx) => this.mergePreview(tx, dto));
  }
  async merge(user: AuthUser, dto: MergeCustomersDto) {
    this.manager(user);
    return atomic(this.prisma, async (tx) => {
      const preview = await this.mergePreview(tx, dto);
      if (dto.token !== preview.token) throw new ConflictException('Dữ liệu đã thay đổi. Hãy xem trước lại.');
      if (preview.taxConflict) throw new BadRequestException('Hai mã số thuế khác nhau; không thể hợp nhất');
      const { source, target } = preview;
      // Transfer every customer relation; source remains a tombstone for traceability.
      await tx.customerContact.updateMany({
        where: { customerId: source.id },
        data: {
          customerId: target.id,
          ...((await tx.customerContact.count({ where: { customerId: target.id, isPrimary: true } })) > 0 && {
            isPrimary: false,
          }),
        },
      });
      for (const relation of await tx.customerTagRelation.findMany({ where: { customerId: source.id } }))
        await tx.customerTagRelation.upsert({
          where: { customerId_tagId: { customerId: target.id, tagId: relation.tagId } },
          create: { customerId: target.id, tagId: relation.tagId },
          update: {},
        });
      await tx.customerTagRelation.deleteMany({ where: { customerId: source.id } });
      await tx.order.updateMany({ where: { customerId: source.id }, data: { customerId: target.id } });
      await tx.activity.updateMany({ where: { customerId: source.id }, data: { customerId: target.id } });
      await tx.task.updateMany({ where: { customerId: source.id }, data: { customerId: target.id } });
      await tx.ticket.updateMany({ where: { customerId: source.id }, data: { customerId: target.id } });
      const automated = await tx.task.findMany({
        where: { customerId: target.id, source: 'AUTOMATION', status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      });
      if (automated.length > 1)
        await tx.task.updateMany({
          where: { id: { in: automated.slice(1).map((t) => t.id) } },
          data: { status: 'CANCELED', result: 'Gộp việc tự động trùng sau hợp nhất khách' },
        });
      await tx.opportunity.updateMany({ where: { customerId: source.id }, data: { customerId: target.id } });
      await tx.automationExecution.updateMany({ where: { customerId: source.id }, data: { customerId: target.id } });
      await tx.externalIdMapping.updateMany({
        where: { entityType: 'customer', entityId: source.id },
        data: { entityId: target.id },
      });
      // Preserve the old code as an import alias, even for manually created customers.
      await tx.externalIdMapping.upsert({
        where: { system_entityType_externalId: { system: 'csv', entityType: 'customer', externalId: source.code } },
        create: { system: 'csv', entityType: 'customer', externalId: source.code, entityId: target.id },
        update: { entityId: target.id },
      });
      await tx.customer.update({
        where: { id: source.id },
        data: { deletedAt: new Date(), mergedIntoId: target.id, taxCode: null },
      });
      // Keep target fields; fill blanks only. Consent is conservative across both records.
      await tx.customer.update({
        where: { id: target.id },
        data: {
          phone: target.phone || source.phone,
          email: target.email || source.email,
          address: target.address || source.address,
          industry: target.industry || source.industry,
          tier: target.tier || source.tier,
          source: target.source || source.source,
          taxCode: target.taxCode || source.taxCode,
          ownerId: target.ownerId || source.ownerId,
          marketingConsent: target.marketingConsent && source.marketingConsent,
          notes:
            [target.notes, source.notes ? `[Từ ${source.code}] ${source.notes}` : ''].filter(Boolean).join('\n\n') ||
            null,
          overdueDebtDays: Math.max(target.overdueDebtDays ?? 0, source.overdueDebtDays ?? 0),
        },
      });
      const today = businessToday(),
        now = new Date();
      const [orders, lines, tickets, activities] = await Promise.all([
        tx.order.findMany({
          where: { customerId: target.id, status: { not: 'CANCELED' } },
          select: { totalAmount: true, orderDate: true },
        }),
        tx.orderItem.findMany({
          where: { order: { customerId: target.id, status: { not: 'CANCELED' } } },
          select: { sku: true, productName: true, quantity: true, order: { select: { orderDate: true } } },
        }),
        tx.ticket.findMany({
          where: { customerId: target.id, status: { notIn: ['RESOLVED', 'CLOSED'] } },
          select: { slaBreached: true },
        }),
        tx.activity.findMany({
          where: { customerId: target.id, type: { in: ['CALL', 'EMAIL', 'ZALO', 'MEETING', 'VISIT', 'NOTE'] } },
          select: { occurredAt: true, outcome: true },
        }),
      ]);
      const cycles = forecastRows(lines, today)
        .filter((f) => f.orderCount >= 3 && daysBetween(f.lastOrderDate, today) <= 365)
        .map((f) => f.cycleDays);
      const stats = computeCustomerStats(
        orders.map((o) => ({ date: o.orderDate, amount: Number(o.totalAmount) })),
        today,
        { skuCycleDays: cycles },
      );
      const recent = activities.filter((a) => a.occurredAt.getTime() >= now.getTime() - 30 * 86400000);
      const health = calculateHealth({
        daysSinceLastOrder: stats.daysSinceLastOrder,
        orderCycleDays: stats.orderCycleDays,
        revenue12m: stats.revenue12m,
        revenuePrev12m: stats.revenuePrev12m,
        openTickets: tickets.length,
        breachedTickets: tickets.filter((t) => t.slaBreached).length,
        overdueDebtDays: Math.max(target.overdueDebtDays ?? 0, source.overdueDebtDays ?? 0),
        recentActivities: recent.length,
        recentPositive: recent.some((a) => a.outcome === 'POSITIVE'),
      });
      const segment = segmentOf({
        tier: target.tier || source.tier,
        revenue12m: stats.revenue12m,
        daysSinceFirstOrder: stats.firstOrderAt ? daysBetween(stats.firstOrderAt, today) : null,
        daysSinceLastOrder: stats.daysSinceLastOrder,
        orderCycleDays: stats.orderCycleDays,
        healthLevel: health.level,
      });
      const { daysSinceLastOrder, revenueTotal, revenue12m, revenuePrev12m, ...persisted } = stats;
      const eligibleOrders = orders.filter((o) => daysBetween(o.orderDate, today) >= 0);
      const sum = (rows: typeof orders) => rows.reduce((value, o) => value.plus(o.totalAmount), new Prisma.Decimal(0));
      const exactRevenue = {
        revenueTotal: sum(eligibleOrders),
        revenue12m: sum(eligibleOrders.filter((o) => daysBetween(o.orderDate, today) < 365)),
        revenuePrev12m: sum(
          eligibleOrders.filter((o) => daysBetween(o.orderDate, today) >= 365 && daysBetween(o.orderDate, today) < 730),
        ),
      };
      const lastActivityAt =
        activities.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]?.occurredAt ?? null;
      await tx.customer.update({
        where: { id: target.id },
        data: {
          ...persisted,
          ...exactRevenue,
          segment,
          healthScore: health.score,
          healthLevel: health.level,
          healthReasons: { reasons: health.reasons, breakdown: health.breakdown },
          healthUpdatedAt: now,
          lastActivityAt,
        },
      });
      await tx.activity.create({
        data: {
          customerId: target.id,
          userId: user.id,
          type: 'SYSTEM',
          content: `Hợp nhất khách ${source.code} vào ${target.code}. Đã tính lại doanh thu và điểm sức khỏe.`,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'merge',
          entityType: 'Customer',
          entityId: target.id,
          changes: JSON.parse(JSON.stringify({ source, target, counts: preview.counts })),
        },
      });
      return { id: target.id, mergedId: source.id, counts: preview.counts };
    });
  }
  private manager(user: AuthUser) {
    if (!seesAll(user)) throw new ForbiddenException('Chỉ quản lý được xem và hợp nhất khách trùng');
  }
  private async mergePreview(tx: Prisma.TransactionClient, dto: MergePreviewDto) {
    if (dto.sourceId === dto.targetId) throw new BadRequestException('Chọn hai khách khác nhau');
    const source = await tx.customer.findFirst({
      where: { id: dto.sourceId, deletedAt: null },
      include: {
        _count: {
          select: {
            contacts: true,
            orders: true,
            activities: true,
            tasks: true,
            tickets: true,
            opportunities: true,
            tags: true,
            executions: true,
          },
        },
      },
    });
    const target = await tx.customer.findFirst({
      where: { id: dto.targetId, deletedAt: null },
      include: {
        _count: {
          select: {
            contacts: true,
            orders: true,
            activities: true,
            tasks: true,
            tickets: true,
            opportunities: true,
            tags: true,
            executions: true,
          },
        },
      },
    });
    if (!source || !target) throw new NotFoundException('Khách đã bị xóa hoặc hợp nhất');
    const reasons = duplicateReasons(source, target);
    if (!reasons.length) throw new BadRequestException('Hai khách không có dấu hiệu trùng');
    const mappings = await tx.externalIdMapping.count({ where: { entityType: 'customer', entityId: source.id } });
    const taxConflict = Boolean(
      source.taxCode && target.taxCode && normalizeTax(source.taxCode) !== normalizeTax(target.taxCode),
    );
    const counts = { ...source._count, externalMappings: mappings };
    const token = createHash('sha256').update(JSON.stringify({ source, target, counts })).digest('hex');
    return { source, target, counts, reasons, taxConflict, token };
  }
}
