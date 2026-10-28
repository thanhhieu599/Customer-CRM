import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, seesAll } from '../common/current-user';
import { paged, skipTake } from '../common/pagination';
import { startOfBusinessDay } from '../common/business-time';
import { Prisma } from '../generated/prisma/client';
import { assertCustomerAccess } from '../customers/customer-access';
import { CompleteTaskDto, CreateTaskDto, TaskQuery, UpdateTaskDto } from './tasks.dto';

const OPEN = ['OPEN', 'IN_PROGRESS'] as const;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: TaskQuery) {
    const where: Prisma.TaskWhereInput = { ...this.visibility(user, q.assignee) };
    if (q.status) where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.type) where.type = q.type;

    const now = new Date();
    if (q.view === 'overdue') Object.assign(where, { status: { in: [...OPEN] }, dueAt: { lt: now } });
    if (q.view === 'today') Object.assign(where, { status: { in: [...OPEN] }, dueAt: { lt: startOfBusinessDay(undefined, 1) } });
    if (q.view === 'week') Object.assign(where, { status: { in: [...OPEN] }, dueAt: { lt: startOfBusinessDay(undefined, 7) } });
    if (q.view === 'open') Object.assign(where, { status: { in: [...OPEN] } });

    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        include: {
          customer: { select: { id: true, name: true, code: true, segment: true, healthScore: true } },
          assignee: { select: { id: true, name: true } },
          ticket: { select: { id: true, number: true, subject: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.task.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async create(user: AuthUser, dto: CreateTaskDto) {
    if (dto.customerId) await assertCustomerAccess(this.prisma, user, dto.customerId);
    if (dto.assigneeId && dto.assigneeId !== user.id && !seesAll(user)) {
      throw new ForbiddenException('Nhân viên chỉ tự giao việc cho mình');
    }
    const task = await this.prisma.task.create({
      data: { ...dto, dueAt: new Date(dto.dueAt), assigneeId: dto.assigneeId ?? user.id, createdById: user.id },
    });
    await this.audit.log({ userId: user.id, action: 'create', entityType: 'Task', entityId: task.id });
    return task;
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskDto) {
    await this.load(user, id);
    if (dto.assigneeId && !seesAll(user) && dto.assigneeId !== user.id) {
      throw new ForbiddenException('Chỉ quản lý mới giao việc cho người khác');
    }
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.dueAt && { dueAt: new Date(dto.dueAt) }),
        ...(dto.status === 'DONE' && { completedAt: new Date() }),
      },
    });
    await this.audit.log({ userId: user.id, action: 'update', entityType: 'Task', entityId: id, changes: dto });
    return task;
  }

  /** Close a task with its result; by default the result goes on the customer timeline. */
  async complete(user: AuthUser, id: string, dto: CompleteTaskDto) {
    const task = await this.load(user, id);
    const now = new Date();
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.task.update({ where: { id }, data: { status: 'DONE', completedAt: now, result: dto.result } }),
    ];
    if (dto.logActivity !== false && task.customerId) {
      ops.push(
        this.prisma.activity.create({
          data: {
            customerId: task.customerId,
            userId: user.id,
            type: dto.activityType ?? 'CALL',
            outcome: dto.outcome ?? null,
            content: `${task.title}\n→ ${dto.result}`,
            metadata: { taskId: id },
          },
        }),
        this.prisma.customer.update({ where: { id: task.customerId }, data: { lastActivityAt: now } }),
      );
    }
    await this.prisma.$transaction(ops);
    await this.audit.log({ userId: user.id, action: 'complete', entityType: 'Task', entityId: id });
    return { ok: true };
  }

  private visibility(user: AuthUser, assignee?: string): Prisma.TaskWhereInput {
    if (!seesAll(user)) {
      return { OR: [{ assigneeId: user.id }, { customer: { ownerId: user.id } }] };
    }
    if (!assignee || assignee === 'all') return {};
    if (assignee === 'mine') return { assigneeId: user.id };
    if (assignee === 'unassigned') return { assigneeId: null };
    return { assigneeId: assignee };
  }

  private async load(user: AuthUser, id: string) {
    const task = await this.prisma.task.findUnique({ where: { id }, include: { customer: { select: { ownerId: true } } } });
    if (!task) throw new NotFoundException();
    if (!seesAll(user) && task.assigneeId !== user.id && task.customer?.ownerId !== user.id) {
      throw new ForbiddenException();
    }
    return task;
  }
}
