import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { assertCustomerAccess, customerScope } from '../customers/customer-access';
import { paged, skipTake } from '../common/pagination';
import { atomic } from '../common/transaction';
import { businessToday, startOfBusinessDay } from '../common/business-time';
import { Prisma } from '../generated/prisma/client';
import { CreateOpportunityDto, UpdateOpportunityDto, SalesQuery, CreateQuoteDto, QuoteStatusDto } from './sales.dto';
import { priceQuote } from './money';
const CLOSED = ['WON', 'LOST'];
@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}
  async list(user: AuthUser, q: SalesQuery) {
    const where: Prisma.OpportunityWhereInput = {
      customer: customerScope(user),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.stage && { stage: q.stage }),
      ...(q.q && { title: { contains: q.q, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } } },
          quotes: { orderBy: { version: 'desc' } },
        },
        orderBy: { nextActionAt: 'asc' },
        ...skipTake(q),
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return paged(items, total, q);
  }
  async get(user: AuthUser, id: string) {
    const item = await this.prisma.opportunity.findUnique({
      where: { id },
      include: { customer: true, quotes: { orderBy: { version: 'desc' } } },
    });
    if (!item) throw new NotFoundException('Không tìm thấy cơ hội');
    await assertCustomerAccess(this.prisma, user, item.customerId);
    return item;
  }
  async create(user: AuthUser, dto: CreateOpportunityDto) {
    await assertCustomerAccess(this.prisma, user, dto.customerId);
    return atomic(this.prisma, async (tx) => {
      await this.access(tx, user, dto.customerId);
      const item = await tx.opportunity.create({
        data: {
          ...dto,
          title: dto.title.trim(),
          expectedCloseAt: new Date(dto.expectedCloseAt),
          nextActionAt: new Date(dto.nextActionAt),
        },
      });
      await this.event(tx, user, item.customerId, 'create', item.id, `Tạo cơ hội: ${item.title}`);
      return item;
    });
  }
  async update(user: AuthUser, id: string, dto: UpdateOpportunityDto) {
    await this.get(user, id);
    return atomic(this.prisma, async (tx) => {
      const before = await tx.opportunity.findUniqueOrThrow({ where: { id } });
      await this.access(tx, user, before.customerId);
      if (before.version !== dto.version) throw new ConflictException('Cơ hội đã thay đổi. Hãy tải lại.');
      if (CLOSED.includes(before.stage)) throw new BadRequestException('Cơ hội đã đóng không thể sửa');
      if (dto.stage === 'LOST' && !dto.lossReason?.trim()) throw new BadRequestException('Cần ghi lý do thua');
      const { version, ...changes } = dto;
      const item = await tx.opportunity.update({
        where: { id, version },
        data: {
          ...changes,
          version: { increment: 1 },
          ...(dto.expectedCloseAt && { expectedCloseAt: new Date(dto.expectedCloseAt) }),
          ...(dto.nextActionAt && { nextActionAt: new Date(dto.nextActionAt) }),
        },
      });
      if (dto.stage && CLOSED.includes(dto.stage)) {
        await tx.task.updateMany({
          where: { quote: { opportunityId: id }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'CANCELED' },
        });
      }
      await this.event(
        tx,
        user,
        item.customerId,
        'update',
        id,
        `Cơ hội ${item.title}: ${before.stage} → ${item.stage}`,
        dto,
      );
      return item;
    });
  }
  async createQuote(user: AuthUser, id: string, dto: CreateQuoteDto) {
    await this.get(user, id);
    let priced: ReturnType<typeof priceQuote>;
    try {
      priced = priceQuote(dto.items, dto.discountAmount, dto.vatPercent);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (new Date(dto.validUntil).getTime() < businessToday().getTime())
      throw new BadRequestException('Ngày hết hạn không được ở quá khứ');
    if (new Date(dto.followUpAt).getTime() <= Date.now())
      throw new BadRequestException('Ngày theo dõi phải ở tương lai');
    if (new Date(dto.followUpAt) >= startOfBusinessDay(new Date(dto.validUntil), 1))
      throw new BadRequestException('Ngày theo dõi phải trong thời hạn báo giá');
    return atomic(this.prisma, async (tx) => {
      const opp = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        include: { customer: true, quotes: { orderBy: { version: 'desc' }, take: 1 } },
      });
      await this.access(tx, user, opp.customerId);
      if (CLOSED.includes(opp.stage)) throw new BadRequestException('Không thể báo giá cho cơ hội đã đóng');
      if (opp.quotes[0]?.status === 'DRAFT')
        throw new ConflictException('Hãy xử lý bản nháp hiện tại trước khi tạo phiên bản mới');
      const version = (opp.quotes[0]?.version ?? 0) + 1;
      const { customer: c } = opp;
      const quote = await tx.quote.create({
        data: {
          opportunityId: id,
          version,
          number: `BG-${id}-${version}`,
          customerSnapshot: {
            code: c.code,
            name: c.name,
            taxCode: c.taxCode,
            address: c.address,
            email: c.email,
            phone: c.phone,
          },
          ...priced,
          validUntil: new Date(dto.validUntil),
          followUpAt: new Date(dto.followUpAt),
          notes: dto.notes,
        },
      });
      await tx.opportunity.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.event(tx, user, c.id, 'quote.create', quote.id, `Lập báo giá phiên bản ${version}: ${opp.title}`);
      return quote;
    });
  }
  async quote(user: AuthUser, id: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id }, include: { opportunity: true } });
    if (!quote) throw new NotFoundException('Không tìm thấy báo giá');
    await assertCustomerAccess(this.prisma, user, quote.opportunity.customerId);
    return quote;
  }
  async quoteStatus(user: AuthUser, id: string, dto: QuoteStatusDto) {
    await this.quote(user, id);
    return atomic(this.prisma, async (tx) => {
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id },
        include: { opportunity: { include: { customer: true } } },
      });
      const opp = quote.opportunity;
      await this.access(tx, user, opp.customerId);
      if (CLOSED.includes(opp.stage)) throw new BadRequestException('Cơ hội đã đóng');
      const latest = await tx.quote.findFirstOrThrow({
        where: { opportunityId: opp.id },
        orderBy: { version: 'desc' },
      });
      if (quote.status === 'DRAFT' && latest.id !== id) throw new ConflictException('Chỉ phát hành bản nháp mới nhất');
      if (
        !(
          (quote.status === 'DRAFT' && ['SENT', 'REJECTED'].includes(dto.status)) ||
          (quote.status === 'SENT' && ['ACCEPTED', 'REJECTED'].includes(dto.status))
        )
      )
        throw new BadRequestException('Chuyển trạng thái báo giá không hợp lệ');
      if (['SENT', 'ACCEPTED'].includes(dto.status) && quote.validUntil.getTime() < businessToday().getTime())
        throw new BadRequestException('Báo giá đã hết hạn');
      if (dto.status === 'SENT') {
        if (quote.followUpAt.getTime() <= Date.now())
          throw new BadRequestException('Hạn theo dõi đã qua; hãy lập phiên bản mới');
        await tx.quote.updateMany({
          where: { opportunityId: opp.id, status: 'SENT', id: { not: id } },
          data: { status: 'SUPERSEDED' },
        });
        await tx.task.updateMany({
          where: { quote: { opportunityId: opp.id }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'CANCELED' },
        });
        await tx.task.create({
          data: {
            quoteId: id,
            customerId: opp.customerId,
            title: `Theo dõi báo giá: ${opp.title} (v${quote.version})`,
            type: 'FOLLOW_UP',
            dueAt: quote.followUpAt,
            assigneeId: opp.customer.ownerId ?? user.id,
            createdById: user.id,
          },
        });
      } else if (dto.status === 'ACCEPTED') {
        await tx.quote.updateMany({
          where: { opportunityId: opp.id, id: { not: id }, status: { in: ['DRAFT', 'SENT'] } },
          data: { status: 'SUPERSEDED' },
        });
        await tx.task.updateMany({
          where: { quote: { opportunityId: opp.id }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'CANCELED' },
        });
      } else {
        await tx.task.updateMany({
          where: { quoteId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'CANCELED' },
        });
      }
      await tx.opportunity.update({
        where: { id: opp.id },
        data: {
          version: { increment: 1 },
          ...(dto.status === 'SENT' && { stage: 'QUOTED', value: quote.total, nextActionAt: quote.followUpAt }),
          ...(dto.status === 'ACCEPTED' && { stage: 'WON', value: quote.total }),
        },
      });
      const result = await tx.quote.update({
        where: { id },
        data: { status: dto.status, ...(dto.status === 'SENT' && { sentAt: new Date() }) },
      });
      await this.event(
        tx,
        user,
        opp.customerId,
        'quote.status',
        id,
        `Báo giá v${quote.version}: ${quote.status} → ${dto.status}`,
        { from: quote.status, to: dto.status },
      );
      return result;
    });
  }
  private async access(tx: Prisma.TransactionClient, user: AuthUser, customerId: string) {
    if (!(await tx.customer.findFirst({ where: { id: customerId, ...customerScope(user) }, select: { id: true } })))
      throw new ForbiddenException('Không có quyền truy cập khách hàng');
  }
  private async event(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    customerId: string,
    action: string,
    id: string,
    content: string,
    changes?: object,
  ) {
    await tx.activity.create({ data: { customerId, userId: user.id, type: 'STATUS_CHANGE', content } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action,
        entityType: action.startsWith('quote') ? 'Quote' : 'Opportunity',
        entityId: id,
        changes: changes as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
