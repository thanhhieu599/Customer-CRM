import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, OrderStatus } from '../generated/prisma/client';

export interface OrderInput {
  code: string;
  customerId: string;
  orderDate: Date;
  status?: OrderStatus;
  deliveredAt?: Date | null;
  source?: string;
  items: { sku: string; productName: string; quantity: number; unit?: string | null; unitPrice: number; amount?: number }[];
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or replaces an order by its code (idempotent – safe to re-import
   * the same MISA/Sapo export). Adds an ORDER activity on first creation.
   */
  async upsert(input: OrderInput, userId?: string | null): Promise<{ id: string; created: boolean }> {
    const items = input.items.map((i) => ({
      sku: i.sku.trim().toUpperCase(),
      productName: i.productName,
      quantity: i.quantity,
      unit: i.unit ?? null,
      unitPrice: i.unitPrice,
      amount: i.amount ?? Math.round(i.quantity * i.unitPrice * 100) / 100,
    }));
    const total = items.reduce((a, i) => a + i.amount, 0);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { code: input.code }, select: { id: true } });
      const data = {
        customerId: input.customerId,
        orderDate: input.orderDate,
        status: input.status ?? 'CONFIRMED',
        deliveredAt: input.deliveredAt ?? null,
        source: input.source ?? 'manual',
        totalAmount: new Prisma.Decimal(total.toFixed(2)),
      };

      if (existing) {
        await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
        await tx.order.update({ where: { id: existing.id }, data: { ...data, items: { create: items } } });
        return { id: existing.id, created: false };
      }

      const order = await tx.order.create({ data: { code: input.code, ...data, items: { create: items } } });
      await tx.activity.create({
        data: {
          customerId: input.customerId,
          userId: userId ?? null,
          type: 'ORDER',
          content: `Đơn hàng ${input.code}: ${items.length} mặt hàng, ${total.toLocaleString('vi-VN')} đ`,
          occurredAt: input.orderDate,
          metadata: { orderId: order.id },
        },
      });
      return { id: order.id, created: true };
    });
  }
}
