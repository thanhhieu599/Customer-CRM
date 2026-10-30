import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, seesAll } from '../common/current-user';
import { paged, skipTake } from '../common/pagination';
import { Prisma } from '../generated/prisma/client';
import { ReorderService } from '../retention/reorder.service';
import { ContactDto, CreateCustomerDto, CustomerQuery, UpdateContactDto, UpdateCustomerDto } from './customers.dto';
import { assertCustomerAccess, customerScope } from './customer-access';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reorder: ReorderService,
  ) {}

  async list(user: AuthUser, q: CustomerQuery) {
    const where: Prisma.CustomerWhereInput = {
      ...customerScope(user),
      ...(q.segment && { segment: q.segment }),
      ...(q.healthLevel && { healthLevel: q.healthLevel }),
      ...(seesAll(user) && q.ownerId && { ownerId: q.ownerId }),
      ...(q.tag && { tags: { some: { tag: { name: q.tag } } } }),
      ...(q.lastContactDays && {
        AND: [
          {
            OR: [
              { lastActivityAt: null },
              { lastActivityAt: { lt: new Date(Date.now() - q.lastContactDays * 86400000) } },
            ],
          },
        ],
      }),
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { code: { contains: q.q, mode: 'insensitive' } },
          { taxCode: { contains: q.q } },
          { phone: { contains: q.q } },
          {
            contacts: {
              some: { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] },
            },
          },
        ],
      }),
    };
    const sort = q.sort ?? 'name';
    const dir = q.order ?? (sort === 'name' ? 'asc' : 'desc');
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: ['healthScore', 'lastOrderAt'].includes(sort)
          ? { [sort]: { sort: dir, nulls: 'last' } } // nullable columns
          : { [sort]: dir },
        include: {
          owner: { select: { id: true, name: true } },
          tags: { include: { tag: true } },
          _count: { select: { tickets: { where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } } } },
        },
        ...skipTake(q),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Customer 360°: everything about one customer on one page. */
  async get360(user: AuthUser, id: string) {
    await assertCustomerAccess(this.prisma, user, id);
    const [customer, timeline, openTasks, tickets, orders, forecasts] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({
        where: { id },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
          tags: { include: { tag: true } },
        },
      }),
      this.prisma.activity.findMany({
        where: { customerId: id },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        include: { user: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
      }),
      this.prisma.task.findMany({
        where: { customerId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: { dueAt: 'asc' },
        include: { assignee: { select: { id: true, name: true } } },
      }),
      this.prisma.ticket.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { assignee: { select: { id: true, name: true } } },
      }),
      this.prisma.order.findMany({
        where: { customerId: id },
        orderBy: { orderDate: 'desc' },
        take: 20,
        include: { items: true },
      }),
      this.reorder.forecastForCustomer(id),
    ]);
    return { customer, timeline, openTasks, tickets, orders, forecasts };
  }

  async create(user: AuthUser, dto: CreateCustomerDto) {
    if (!seesAll(user) && dto.ownerId && dto.ownerId !== user.id)
      throw new ForbiddenException('Nhân viên chỉ tạo khách cho mình');
    try {
      const c = await this.prisma.customer.create({
        data: { ...dto, ownerId: dto.ownerId ?? user.id },
      });
      await this.audit.log({ userId: user.id, action: 'create', entityType: 'Customer', entityId: c.id, changes: dto });
      return c;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Mã khách hàng hoặc mã số thuế đã tồn tại');
      }
      throw e;
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerDto) {
    await assertCustomerAccess(this.prisma, user, id);
    if (!seesAll(user) && dto.ownerId !== undefined)
      throw new ForbiddenException('Chỉ quản lý được chuyển người phụ trách');
    const { tags, ...data } = dto;
    const before = await this.prisma.customer.findUniqueOrThrow({ where: { id } });

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.update({ where: { id }, data });
      if (tags) {
        await tx.customerTagRelation.deleteMany({ where: { customerId: id } });
        for (const name of [...new Set(tags.map((t) => t.trim()).filter(Boolean))]) {
          const tag = await tx.customerTag.upsert({ where: { name }, create: { name }, update: {} });
          await tx.customerTagRelation.create({ data: { customerId: id, tagId: tag.id } });
        }
      }
      if (data.ownerId !== undefined && data.ownerId !== before.ownerId) {
        await tx.activity.create({
          data: { customerId: id, userId: user.id, type: 'STATUS_CHANGE', content: 'Đổi người phụ trách khách hàng' },
        });
      }
      return c;
    });

    const changes = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v),
    );
    await this.audit.log({
      userId: user.id,
      action: 'update',
      entityType: 'Customer',
      entityId: id,
      changes: { ...changes, tags },
    });
    return updated;
  }

  async remove(user: AuthUser, id: string) {
    await assertCustomerAccess(this.prisma, user, id);
    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'delete', entityType: 'Customer', entityId: id });
    return { ok: true };
  }

  async addContact(user: AuthUser, customerId: string, dto: ContactDto) {
    await assertCustomerAccess(this.prisma, user, customerId);
    const contact = await this.prisma.customerContact.create({ data: { ...dto, customerId } });
    await this.audit.log({ userId: user.id, action: 'create', entityType: 'CustomerContact', entityId: contact.id });
    return contact;
  }

  async updateContact(user: AuthUser, customerId: string, contactId: string, dto: UpdateContactDto) {
    await assertCustomerAccess(this.prisma, user, customerId);
    const { leftCompany, ...data } = dto;
    const contact = await this.prisma.customerContact.update({
      where: { id: contactId, customerId },
      data: { ...data, ...(leftCompany !== undefined && { leftCompanyAt: leftCompany ? new Date() : null }) },
    });
    await this.audit.log({
      userId: user.id,
      action: 'update',
      entityType: 'CustomerContact',
      entityId: contactId,
      changes: dto,
    });
    return contact;
  }
}
