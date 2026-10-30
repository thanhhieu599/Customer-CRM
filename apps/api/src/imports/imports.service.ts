import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ContactRole, CustomerType, OrderStatus, Prisma } from '../generated/prisma/client';
import { parseDay } from '../retention/domain/dates';
import { parseCsv, parseNumber } from './parse';

/** Accepted header names (normalized) per field – English or Vietnamese / MISA style. */
const CUSTOMER_COLUMNS = {
  code: ['code', 'customer_code', 'ma_kh', 'ma_khach_hang', 'ma_doi_tuong'],
  name: ['name', 'customer_name', 'ten_kh', 'ten_khach_hang', 'ten_doi_tuong'],
  taxCode: ['tax_code', 'mst', 'ma_so_thue'],
  type: ['type', 'loai'],
  industry: ['industry', 'nganh', 'nganh_nghe'],
  tier: ['tier', 'hang', 'phan_hang'],
  source: ['source', 'nguon'],
  phone: ['phone', 'dien_thoai', 'sdt'],
  email: ['email'],
  address: ['address', 'dia_chi'],
  ownerEmail: ['owner_email', 'email_nhan_vien', 'nguoi_phu_trach'],
  overdueDebtDays: ['overdue_debt_days', 'so_ngay_qua_han'],
  contactName: ['contact_name', 'nguoi_lien_he'],
  contactTitle: ['contact_title', 'chuc_vu'],
  contactRole: ['contact_role', 'vai_tro'],
  contactPhone: ['contact_phone', 'dien_thoai_lien_he'],
  contactEmail: ['contact_email', 'email_lien_he'],
} as const;

const ORDER_COLUMNS = {
  orderCode: ['order_code', 'so_chung_tu', 'so_don_hang', 'so_ct'],
  customerCode: ['customer_code', 'code', 'ma_kh', 'ma_khach_hang', 'ma_doi_tuong'],
  orderDate: ['order_date', 'ngay_chung_tu', 'ngay_dat_hang', 'ngay_ct'],
  sku: ['sku', 'ma_hang', 'ma_vat_tu'],
  productName: ['product_name', 'ten_hang', 'ten_vat_tu'],
  quantity: ['quantity', 'so_luong'],
  unit: ['unit', 'dvt', 'don_vi_tinh'],
  unitPrice: ['unit_price', 'don_gia'],
  amount: ['amount', 'thanh_tien'],
  status: ['status', 'trang_thai'],
  deliveredDate: ['delivered_date', 'ngay_giao', 'ngay_giao_hang'],
} as const;

type Row = Record<string, string>;
const pick = (row: Row, names: readonly string[]) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
  return undefined;
};

const CONTACT_ROLES: Record<string, ContactRole> = {
  purchasing: 'PURCHASING',
  'mua hang': 'PURCHASING',
  'mua hàng': 'PURCHASING',
  ehs: 'EHS',
  hse: 'EHS',
  'an toan': 'EHS',
  'an toàn': 'EHS',
  qa: 'QA',
  qc: 'QA',
  warehouse: 'WAREHOUSE',
  kho: 'WAREHOUSE',
  admin: 'ADMIN',
  'hanh chinh': 'ADMIN',
  'hành chính': 'ADMIN',
  production: 'PRODUCTION',
  'san xuat': 'PRODUCTION',
};

export interface ImportReport {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async importCustomers(csv: string, system: string, userId: string): Promise<ImportReport> {
    const rows = parseCsv(csv);
    this.requireColumns(rows, CUSTOMER_COLUMNS.code, CUSTOMER_COLUMNS.name);
    const log = await this.prisma.syncLog.create({ data: { system, kind: 'customers' } });
    const report: ImportReport = { rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
    const users = new Map(
      (await this.prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
    );
    const seen = new Set<string>();

    for (const [i, row] of rows.entries()) {
      const line = i + 2; // header is line 1
      try {
        const code = pick(row, CUSTOMER_COLUMNS.code)?.trim();
        const name = pick(row, CUSTOMER_COLUMNS.name)?.trim();
        if (!code || !name) throw new Error('Thiếu mã hoặc tên khách hàng');
        if (seen.has(code)) {
          // Same customer repeated (one row per contact) → only add the contact.
          const id = await this.findCustomerId(system, code, undefined);
          if (id) await this.upsertContact(id, row);
          report.skipped++;
          continue;
        }
        seen.add(code);

        const taxCode = pick(row, CUSTOMER_COLUMNS.taxCode)?.replace(/\s/g, '') || undefined;
        const ownerEmail = pick(row, CUSTOMER_COLUMNS.ownerEmail)?.toLowerCase();
        const tier = pick(row, CUSTOMER_COLUMNS.tier)?.toUpperCase();
        const debt = parseNumber(pick(row, CUSTOMER_COLUMNS.overdueDebtDays));
        const data = {
          name,
          taxCode,
          type: (pick(row, CUSTOMER_COLUMNS.type)?.toUpperCase() === 'INDIVIDUAL'
            ? 'INDIVIDUAL'
            : 'COMPANY') as CustomerType,
          industry: pick(row, CUSTOMER_COLUMNS.industry),
          tier: tier && ['A', 'B', 'C'].includes(tier) ? tier : undefined,
          source: pick(row, CUSTOMER_COLUMNS.source),
          phone: pick(row, CUSTOMER_COLUMNS.phone),
          email: pick(row, CUSTOMER_COLUMNS.email),
          address: pick(row, CUSTOMER_COLUMNS.address),
          ownerId: ownerEmail ? users.get(ownerEmail) : undefined,
          overdueDebtDays: debt === null ? undefined : Math.max(0, Math.round(debt)),
        };
        if (ownerEmail && !data.ownerId) throw new Error(`Không tìm thấy nhân viên ${ownerEmail}`);

        const existingId = await this.findCustomerId(system, code, taxCode);
        let id: string;
        if (existingId) {
          id = (await this.prisma.customer.update({ where: { id: existingId }, data: { ...data, deletedAt: null } }))
            .id;
          report.updated++;
        } else {
          id = (await this.prisma.customer.create({ data: { code, ...data } })).id;
          report.created++;
        }
        await this.prisma.externalIdMapping.upsert({
          where: { system_entityType_externalId: { system, entityType: 'customer', externalId: code } },
          create: { system, entityType: 'customer', externalId: code, entityId: id },
          update: { entityId: id },
        });
        await this.upsertContact(id, row);
      } catch (e) {
        report.errors.push({ row: line, message: this.message(e) });
      }
    }

    await this.finish(log.id, report, userId);
    return report;
  }

  async importOrders(csv: string, system: string, userId: string): Promise<ImportReport> {
    const rows = parseCsv(csv);
    this.requireColumns(
      rows,
      ORDER_COLUMNS.orderCode,
      ORDER_COLUMNS.customerCode,
      ORDER_COLUMNS.orderDate,
      ORDER_COLUMNS.sku,
    );
    const log = await this.prisma.syncLog.create({ data: { system, kind: 'orders' } });
    const report: ImportReport = { rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };

    // One CSV line per order item → group by order code.
    const groups = new Map<string, { lines: number[]; rows: Row[] }>();
    rows.forEach((row, i) => {
      const code = pick(row, ORDER_COLUMNS.orderCode)?.trim();
      if (!code) {
        report.errors.push({ row: i + 2, message: 'Thiếu số chứng từ / mã đơn' });
        return;
      }
      const g = groups.get(code) ?? { lines: [], rows: [] };
      g.lines.push(i + 2);
      g.rows.push(row);
      groups.set(code, g);
    });

    for (const [code, g] of groups) {
      try {
        const first = g.rows[0];
        const customerCode = pick(first, ORDER_COLUMNS.customerCode)!.trim();
        const customerId = await this.findCustomerId(system, customerCode, undefined);
        if (!customerId) throw new Error(`Chưa có khách hàng mã ${customerCode} – hãy import khách hàng trước`);
        const orderDate = parseDay(pick(first, ORDER_COLUMNS.orderDate));
        if (!orderDate) throw new Error('Ngày đặt hàng không hợp lệ (dùng DD/MM/YYYY hoặc YYYY-MM-DD)');
        const deliveredAt = parseDay(pick(first, ORDER_COLUMNS.deliveredDate));
        const rawStatus = pick(first, ORDER_COLUMNS.status)?.toUpperCase();
        const status: OrderStatus =
          rawStatus === 'CANCELED' || rawStatus === 'HUY'
            ? 'CANCELED'
            : deliveredAt || rawStatus === 'DELIVERED'
              ? 'DELIVERED'
              : 'CONFIRMED';

        const items = g.rows.map((r) => {
          const sku = pick(r, ORDER_COLUMNS.sku)?.trim();
          if (!sku) throw new Error('Thiếu mã hàng');
          const quantity = parseNumber(pick(r, ORDER_COLUMNS.quantity)) ?? 0;
          const unitPrice = parseNumber(pick(r, ORDER_COLUMNS.unitPrice)) ?? 0;
          const amount = parseNumber(pick(r, ORDER_COLUMNS.amount)) ?? quantity * unitPrice;
          return {
            sku,
            productName: pick(r, ORDER_COLUMNS.productName) ?? sku,
            quantity,
            unit: pick(r, ORDER_COLUMNS.unit),
            unitPrice,
            amount,
          };
        });

        const result = await this.orders.upsert(
          { code, customerId, orderDate, deliveredAt, status, source: system, items },
          null,
        );
        await this.prisma.externalIdMapping.upsert({
          where: { system_entityType_externalId: { system, entityType: 'order', externalId: code } },
          create: { system, entityType: 'order', externalId: code, entityId: result.id },
          update: { entityId: result.id },
        });
        if (result.created) report.created++;
        else report.updated++;
      } catch (e) {
        report.errors.push({ row: g.lines[0], message: `Đơn ${code}: ${this.message(e)}` });
      }
    }

    await this.finish(log.id, report, userId);
    return report;
  }

  /** External mapping first, then tax code, then internal code. */
  private async findCustomerId(system: string, code: string, taxCode?: string): Promise<string | null> {
    const mapped = await this.prisma.externalIdMapping.findUnique({
      where: { system_entityType_externalId: { system, entityType: 'customer', externalId: code } },
    });
    if (mapped) return this.resolveCustomer(mapped.entityId);
    if (taxCode) {
      const byTax = await this.prisma.customer.findUnique({ where: { taxCode }, select: { id: true } });
      if (byTax) return this.resolveCustomer(byTax.id);
    }
    const byCode = await this.prisma.customer.findUnique({ where: { code }, select: { id: true } });
    return byCode ? this.resolveCustomer(byCode.id) : null;
  }

  /** Follow merge tombstones across import systems; never resurrect a merged source. */
  private async resolveCustomer(id: string): Promise<string | null> {
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const customer = await this.prisma.customer.findUnique({
        where: { id },
        select: { id: true, deletedAt: true, mergedIntoId: true },
      });
      if (!customer) return null;
      if (customer.mergedIntoId) {
        id = customer.mergedIntoId;
        continue;
      }
      return customer.deletedAt ? null : customer.id;
    }
    throw new BadRequestException('Liên kết hợp nhất khách không hợp lệ');
  }

  private async upsertContact(customerId: string, row: Row) {
    const name = pick(row, CUSTOMER_COLUMNS.contactName)?.trim();
    if (!name) return;
    const phone = pick(row, CUSTOMER_COLUMNS.contactPhone);
    const email = pick(row, CUSTOMER_COLUMNS.contactEmail)?.toLowerCase();
    const roleRaw = pick(row, CUSTOMER_COLUMNS.contactRole)?.toLowerCase().trim() ?? '';
    const role = CONTACT_ROLES[roleRaw] ?? (roleRaw.toUpperCase() as ContactRole);
    const data = {
      name,
      title: pick(row, CUSTOMER_COLUMNS.contactTitle),
      role: Object.values(ContactRole).includes(role) ? role : ContactRole.OTHER,
      phone,
      email,
    };
    const existing = await this.prisma.customerContact.findFirst({
      where: { customerId, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : []), { name }] },
    });
    if (existing) await this.prisma.customerContact.update({ where: { id: existing.id }, data });
    else await this.prisma.customerContact.create({ data: { ...data, customerId } });
  }

  private requireColumns(rows: Row[], ...groups: (readonly string[])[]) {
    if (!rows.length) throw new BadRequestException('File CSV không có dữ liệu');
    const headers = Object.keys(rows[0]);
    const missing = groups.filter((names) => !names.some((n) => headers.includes(n))).map((names) => names[0]);
    if (missing.length) throw new BadRequestException(`Thiếu cột bắt buộc: ${missing.join(', ')}`);
  }

  private async finish(logId: string, report: ImportReport, userId: string) {
    const { errors, ...stats } = report;
    await this.prisma.syncLog.update({
      where: { id: logId },
      data: {
        status: errors.length === 0 ? 'SUCCESS' : stats.created + stats.updated > 0 ? 'PARTIAL' : 'FAILED',
        stats,
        errors: errors.slice(0, 500) as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'import', entityType: 'SyncLog', entityId: logId, changes: stats },
    });
  }

  private message(e: unknown): string {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      return 'Trùng mã số thuế với khách hàng khác';
    return (e as Error).message;
  }
}
