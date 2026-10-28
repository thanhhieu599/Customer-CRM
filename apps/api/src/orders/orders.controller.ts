import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested, IsDateString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/current-user';
import { AuditService } from '../audit/audit.service';
import { PageQuery, paged, skipTake } from '../common/pagination';
import { assertCustomerAccess, customerScope } from '../customers/customer-access';
import { OrderStatus } from '../generated/prisma/client';
import { OrdersService } from './orders.service';

class OrderItemDto {
  @IsString() sku: string;
  @IsString() productName: string;
  @IsNumber() @Min(0) quantity: number;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @Min(0) unitPrice: number;
}

class CreateOrderDto {
  @IsString() code: string;
  @IsUUID() customerId: string;
  @IsDateString() orderDate: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @ValidateNested({ each: true }) @Type(() => OrderItemDto) @ArrayMinSize(1) items: OrderItemDto[];
}

class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
  @IsOptional() @IsDateString() deliveredAt?: string;
}

class OrderQuery extends PageQuery {
  @IsOptional() @IsUUID() customerId?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: OrderQuery) {
    const where = { customer: customerScope(user), ...(q.customerId && { customerId: q.customerId }) };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { orderDate: 'desc' },
        include: { customer: { select: { id: true, name: true, code: true } }, items: true },
        ...skipTake(q),
      }),
      this.prisma.order.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    await assertCustomerAccess(this.prisma, user, dto.customerId);
    const result = await this.orders.upsert({ ...dto, orderDate: new Date(dto.orderDate.slice(0, 10)) }, user.id);
    await this.audit.log({ userId: user.id, action: 'create', entityType: 'Order', entityId: result.id, changes: { code: dto.code } });
    return result;
  }

  @Patch(':id/status')
  async setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id }, select: { customerId: true } });
    await assertCustomerAccess(this.prisma, user, order.customerId);
    const deliveredAt =
      dto.status === 'DELIVERED' ? new Date((dto.deliveredAt ?? new Date().toISOString()).slice(0, 10)) : null;
    const updated = await this.prisma.order.update({ where: { id }, data: { status: dto.status, deliveredAt } });
    await this.audit.log({ userId: user.id, action: 'update', entityType: 'Order', entityId: id, changes: dto });
    return updated;
  }
}
