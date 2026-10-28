import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, seesAll } from '../common/current-user';
import { PageQuery, paged, skipTake } from '../common/pagination';
import { assertCustomerAccess, customerScope } from '../customers/customer-access';
import { Prisma, Priority, TicketCategory, TicketStatus } from '../generated/prisma/client';
import { slaDueAt } from '../retention/domain/sla';

class TicketQuery extends PageQuery {
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @IsOptional() @IsString() view?: 'open' | 'breached' | 'mine';
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() q?: string;
}

class CreateTicketDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsString() @MinLength(3) subject: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() assigneeId?: string;
}

class UpdateTicketDto {
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;
  @IsOptional() @IsUUID() assigneeId?: string;
}

class CommentDto {
  @IsString() @MinLength(1) body: string;
  @IsOptional() @IsBoolean() isInternal?: boolean;
}

const OPEN_STATUSES: TicketStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER'];

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: TicketQuery) {
    const where: Prisma.TicketWhereInput = {
      customer: customerScope(user),
      ...(q.status && { status: q.status }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.view === 'open' && { status: { in: OPEN_STATUSES } }),
      ...(q.view === 'breached' && { status: { in: OPEN_STATUSES }, slaBreached: true }),
      ...(q.view === 'mine' && { assigneeId: user.id }),
      ...(q.q && { subject: { contains: q.q, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: [{ slaBreached: 'desc' }, { slaDueAt: 'asc' }],
        include: {
          customer: { select: { id: true, name: true, code: true } },
          assignee: { select: { id: true, name: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Get(':number')
  async get(@CurrentUser() user: AuthUser, @Param('number', ParseIntPipe) number: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { number },
      include: {
        customer: { select: { id: true, name: true, code: true, ownerId: true } },
        contact: true,
        assignee: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } },
        tasks: { orderBy: { dueAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException();
    if (!seesAll(user) && ticket.customer.ownerId !== user.id && ticket.assigneeId !== user.id) {
      throw new ForbiddenException();
    }
    return ticket;
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    const customer = await assertCustomerAccess(this.prisma, user, dto.customerId);
    const now = new Date();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          ...dto,
          assigneeId: dto.assigneeId ?? customer.ownerId ?? user.id,
          slaDueAt: slaDueAt(now, dto.priority ?? 'NORMAL'),
        },
      });
      await tx.activity.create({
        data: {
          customerId: dto.customerId,
          contactId: dto.contactId ?? null,
          userId: user.id,
          type: 'TICKET',
          content: `Ticket #${t.number} (${t.category}): ${t.subject}`,
          metadata: { ticketId: t.id },
        },
      });
      return t;
    });
    await this.audit.log({ userId: user.id, action: 'create', entityType: 'Ticket', entityId: ticket.id });
    return ticket;
  }

  @Patch(':number')
  async update(@CurrentUser() user: AuthUser, @Param('number', ParseIntPipe) number: number, @Body() dto: UpdateTicketDto) {
    const ticket = await this.get(user, number);
    const data: Prisma.TicketUncheckedUpdateInput = { ...dto };

    if (dto.status && ['RESOLVED', 'CLOSED'].includes(dto.status) && !ticket.resolvedAt) {
      data.resolvedAt = new Date();
    }
    if (dto.status && OPEN_STATUSES.includes(dto.status)) data.resolvedAt = null;
    // Re-prioritised before breach → deadline follows the new priority.
    if (dto.priority && dto.priority !== ticket.priority && !ticket.slaBreached) {
      data.slaDueAt = slaDueAt(ticket.createdAt, dto.priority);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.update({ where: { id: ticket.id }, data });
      if (dto.status && dto.status !== ticket.status) {
        await tx.activity.create({
          data: {
            customerId: ticket.customerId,
            userId: user.id,
            type: 'STATUS_CHANGE',
            content: `Ticket #${number}: ${ticket.status} → ${dto.status}`,
            metadata: { ticketId: ticket.id },
          },
        });
      }
      return t;
    });
    await this.audit.log({ userId: user.id, action: 'update', entityType: 'Ticket', entityId: ticket.id, changes: dto });
    return updated;
  }

  @Post(':number/comments')
  async comment(@CurrentUser() user: AuthUser, @Param('number', ParseIntPipe) number: number, @Body() dto: CommentDto) {
    const ticket = await this.get(user, number);
    const [comment] = await this.prisma.$transaction([
      this.prisma.ticketComment.create({ data: { ...dto, ticketId: ticket.id, authorId: user.id } }),
      // First reply to the customer = first response (SLA KPI).
      ...(!dto.isInternal && !ticket.firstResponseAt
        ? [this.prisma.ticket.update({ where: { id: ticket.id }, data: { firstResponseAt: new Date(), ...(ticket.status === 'NEW' && { status: 'IN_PROGRESS' as const }) } })]
        : []),
    ]);
    return comment;
  }
}
