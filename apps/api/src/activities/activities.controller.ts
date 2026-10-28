import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/current-user';
import { PageQuery, paged, skipTake } from '../common/pagination';
import { assertCustomerAccess } from '../customers/customer-access';
import { ActivityOutcome, ActivityType } from '../generated/prisma/client';

const MANUAL_TYPES = ['CALL', 'EMAIL', 'ZALO', 'MEETING', 'VISIT', 'NOTE'] as const;

class CreateActivityDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsIn(MANUAL_TYPES) type: (typeof MANUAL_TYPES)[number];
  @IsOptional() @IsEnum(ActivityOutcome) outcome?: ActivityOutcome;
  @IsString() @MinLength(2) content: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

class ActivityQuery extends PageQuery {
  @IsUUID() customerId: string;
  @IsOptional() @IsEnum(ActivityType) type?: ActivityType;
}

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ActivityQuery) {
    await assertCustomerAccess(this.prisma, user, q.customerId);
    const where = { customerId: q.customerId, ...(q.type && { type: q.type }) };
    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        include: { user: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
        ...skipTake(q),
      }),
      this.prisma.activity.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Log a call / Zalo / visit… This is what keeps the health score honest. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateActivityDto) {
    await assertCustomerAccess(this.prisma, user, dto.customerId);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const [activity] = await this.prisma.$transaction([
      this.prisma.activity.create({ data: { ...dto, occurredAt, userId: user.id } }),
      this.prisma.customer.update({ where: { id: dto.customerId }, data: { lastActivityAt: occurredAt } }),
    ]);
    return activity;
  }
}
