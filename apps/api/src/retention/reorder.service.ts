import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessToday } from '../common/business-time';
import { OrderPoint, predictReorder, ReorderOptions, ReorderPrediction } from './domain/reorder-predictor';

export interface SkuForecast extends ReorderPrediction {
  sku: string;
  productName: string;
}

@Injectable()
export class ReorderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reorder forecast per SKU for one customer, most urgent first. */
  async forecastForCustomer(
    customerId: string,
    options?: ReorderOptions,
    today = businessToday(),
  ): Promise<SkuForecast[]> {
    const rows = await this.prisma.orderItem.findMany({
      where: { order: { customerId, status: { not: 'CANCELED' } } },
      select: { sku: true, productName: true, quantity: true, order: { select: { orderDate: true } } },
    });
    return forecastRows(rows, today, options);
  }

  /** Forecasts for many customers at once (used by the daily engine). */
  async forecastByCustomer(customerIds: string[], options?: ReorderOptions, today = businessToday()) {
    const rows = await this.prisma.orderItem.findMany({
      where: { order: { customerId: { in: customerIds }, status: { not: 'CANCELED' } } },
      select: {
        sku: true,
        productName: true,
        quantity: true,
        order: { select: { orderDate: true, customerId: true } },
      },
    });
    const byCustomer = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byCustomer.get(r.order.customerId) ?? [];
      list.push(r);
      byCustomer.set(r.order.customerId, list);
    }
    const result = new Map<string, SkuForecast[]>();
    for (const [id, list] of byCustomer) result.set(id, forecastRows(list, today, options));
    return result;
  }
}

export function forecastRows(
  rows: { sku: string; productName: string; quantity: unknown; order: { orderDate: Date } }[],
  today: Date,
  options?: ReorderOptions,
): SkuForecast[] {
  const bySku = new Map<string, { name: string; points: OrderPoint[] }>();
  for (const r of rows) {
    const entry = bySku.get(r.sku) ?? { name: r.productName, points: [] };
    entry.points.push({ date: r.order.orderDate, quantity: Number(r.quantity) });
    entry.name = r.productName || entry.name;
    bySku.set(r.sku, entry);
  }
  const forecasts: SkuForecast[] = [];
  for (const [sku, { name, points }] of bySku) {
    const p = predictReorder(points, today, options);
    if (p) forecasts.push({ sku, productName: name, ...p });
  }
  return forecasts.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
