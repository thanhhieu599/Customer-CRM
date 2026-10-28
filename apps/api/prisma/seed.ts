/**
 * Demo data for local development and UAT.
 * All companies and people are FICTIONAL. Run: npm run db:seed
 *
 * Scenarios covered:
 *  - steady monthly buyers (healthy, reorder reminders)
 *  - a VIP whose orders stopped 60+ days ago (win-back, at-risk)
 *  - a dormant customer, a brand-new customer
 *  - an open complaint already past its SLA
 *  - an order delivered 4 days ago (post-delivery check-in)
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const PASSWORD = process.env.SEED_PASSWORD ?? 'Crm@12345';

const day = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};

// Deterministic pseudo-random so every seed gives the same data.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const jitter = (n: number) => Math.round((rand() - 0.5) * 2 * n);

const PRODUCTS = {
  GLV_CUT: { name: 'Găng tay chống cắt cấp C (EN 388)', unit: 'đôi', price: 45_000 },
  GLV_NIT: { name: 'Găng tay nitrile phòng sạch (hộp 100)', unit: 'hộp', price: 165_000 },
  GLV_ESD: { name: 'Găng tay chống tĩnh điện ESD PU', unit: 'đôi', price: 12_000 },
  SHOE_S3: { name: 'Giày bảo hộ S3 (EN ISO 20345)', unit: 'đôi', price: 690_000 },
  MASK_N95: { name: 'Khẩu trang N95 (hộp 20)', unit: 'hộp', price: 310_000 },
  WIPE_CR: { name: 'Khăn lau phòng sạch 9"x9"', unit: 'gói', price: 95_000 },
  TAPE_ESD: { name: 'Băng keo ESD 24mm', unit: 'cuộn', price: 38_000 },
} as const;
type Sku = keyof typeof PRODUCTS;

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const users = {
    admin: await upsertUser('admin@dt-crm.local', 'Quản trị hệ thống', 'ADMIN', passwordHash),
    manager: await upsertUser('quanly@dt-crm.local', 'Trưởng phòng CSKH', 'MANAGER', passwordHash),
    sale1: await upsertUser('sale1@dt-crm.local', 'Nguyễn Minh Anh', 'AGENT', passwordHash),
    sale2: await upsertUser('sale2@dt-crm.local', 'Trần Quốc Bảo', 'AGENT', passwordHash),
  };

  const customers: {
    code: string;
    name: string;
    industry: string;
    tier?: string;
    owner: keyof typeof users;
    /** [sku, cycle days, qty, first order offset, last order offset] */
    lines: [Sku, number, number, number, number][];
    contacts: [string, string, 'PURCHASING' | 'EHS' | 'QA' | 'WAREHOUSE', boolean][];
    debt?: number;
  }[] = [
    {
      code: 'DEMO-001', name: 'Công ty TNHH Điện tử Minh Long (demo)', industry: 'electronics', tier: 'A', owner: 'sale1',
      lines: [['GLV_NIT', 30, 120, -720, -24], ['GLV_ESD', 30, 3000, -720, -24], ['WIPE_CR', 30, 400, -500, -24], ['TAPE_ESD', 60, 300, -400, -50]],
      contacts: [['Lê Thu Hà', 'Purchasing Manager', 'PURCHASING', true], ['Phạm Văn Đức', 'EHS Supervisor', 'EHS', false]],
    },
    {
      code: 'DEMO-002', name: 'Công ty TNHH Linh kiện Bắc Hà (demo)', industry: 'electronics', tier: 'A', owner: 'sale1',
      // VIP that stopped ordering ~65 days ago
      lines: [['GLV_NIT', 28, 200, -700, -65], ['GLV_ESD', 28, 5000, -700, -65], ['MASK_N95', 56, 50, -600, -65]],
      contacts: [['Ngô Thanh Tâm', 'Senior Buyer', 'PURCHASING', true], ['Vũ Hải Yến', 'QA Engineer', 'QA', false]],
    },
    {
      code: 'DEMO-003', name: 'Công ty CP Thép Hưng Phát (demo)', industry: 'steel', tier: 'B', owner: 'sale2',
      lines: [['GLV_CUT', 45, 800, -730, -40], ['SHOE_S3', 180, 120, -720, -170]],
      contacts: [['Đỗ Mạnh Hùng', 'Trưởng phòng An toàn', 'EHS', true], ['Bùi Lan', 'Nhân viên mua hàng', 'PURCHASING', false]],
      debt: 25,
    },
    {
      code: 'DEMO-004', name: 'Công ty TNHH Thực phẩm Sao Mai (demo)', industry: 'food', tier: 'B', owner: 'sale2',
      lines: [['GLV_NIT', 21, 80, -400, -5], ['MASK_N95', 42, 30, -400, -20]],
      contacts: [['Hoàng Ngọc Mai', 'Admin & Purchasing', 'PURCHASING', true]],
    },
    {
      code: 'DEMO-005', name: 'Công ty TNHH Cơ khí Tân Tiến (demo)', industry: 'mechanical', owner: 'sale1',
      // dormant: last order ~260 days ago
      lines: [['GLV_CUT', 60, 300, -700, -260], ['SHOE_S3', 365, 60, -700, -330]],
      contacts: [['Trịnh Văn Long', 'Thủ kho', 'WAREHOUSE', false]],
    },
    {
      code: 'DEMO-006', name: 'Công ty TNHH Kính Ánh Dương (demo)', industry: 'glass', owner: 'sale2',
      // new customer: two orders in the last 2 months
      lines: [['GLV_CUT', 30, 500, -55, -25]],
      contacts: [['Lý Quỳnh Như', 'Purchasing', 'PURCHASING', true]],
    },
    {
      code: 'DEMO-007', name: 'Công ty TNHH Bao bì Phương Nam (demo)', industry: 'manufacturing', owner: 'sale1',
      lines: [['GLV_NIT', 35, 60, -500, -33], ['TAPE_ESD', 35, 100, -500, -33]],
      contacts: [['Mai Xuân Trường', 'Purchasing', 'PURCHASING', true]],
    },
    {
      code: 'DEMO-008', name: 'Công ty CP Xây lắp Đông Á (demo)', industry: 'construction', owner: 'sale2',
      lines: [['SHOE_S3', 90, 80, -600, -95], ['GLV_CUT', 30, 400, -600, -50]],
      contacts: [['Phan Đình Khoa', 'Chỉ huy trưởng công trường', 'EHS', true]],
    },
  ];

  let orderSeq = 1;
  for (const c of customers) {
    const customer = await prisma.customer.upsert({
      where: { code: c.code },
      create: {
        code: c.code, name: c.name, industry: c.industry, tier: c.tier, ownerId: users[c.owner].id,
        source: 'demo', overdueDebtDays: c.debt ?? null, marketingConsent: true,
      },
      update: { name: c.name, industry: c.industry, tier: c.tier, ownerId: users[c.owner].id, overdueDebtDays: c.debt ?? null },
    });
    await prisma.externalIdMapping.upsert({
      where: { system_entityType_externalId: { system: 'csv', entityType: 'customer', externalId: c.code } },
      create: { system: 'csv', entityType: 'customer', externalId: c.code, entityId: customer.id },
      update: {},
    });

    if ((await prisma.customerContact.count({ where: { customerId: customer.id } })) === 0) {
      await prisma.customerContact.createMany({
        data: c.contacts.map(([name, title, role, isDecisionMaker], i) => ({
          customerId: customer.id, name, title, role, isDecisionMaker, isPrimary: i === 0,
          phone: `09${String(10000000 + Math.floor(rand() * 89999999)).slice(0, 8)}`,
        })),
      });
    }

    // Build orders: one order per date, items from every line due that day.
    const byDate = new Map<number, { sku: Sku; qty: number }[]>();
    for (const [sku, cycle, qty, first, last] of c.lines) {
      for (let t = first; t <= last; t += cycle) {
        const offset = t === last ? last : Math.min(last, t + jitter(3));
        byDate.set(offset, [...(byDate.get(offset) ?? []), { sku, qty: Math.max(1, qty + jitter(qty * 0.1)) }]);
      }
    }
    for (const [offset, items] of [...byDate.entries()].sort((a, b) => a[0] - b[0])) {
      const code = `${c.code}-SO${String(orderSeq++).padStart(4, '0')}`;
      if (await prisma.order.findUnique({ where: { code } })) continue;
      const lines = items.map(({ sku, qty }) => ({
        sku, productName: PRODUCTS[sku].name, unit: PRODUCTS[sku].unit, quantity: qty,
        unitPrice: PRODUCTS[sku].price, amount: qty * PRODUCTS[sku].price,
      }));
      const deliveredAt = day(offset + 2);
      const order = await prisma.order.create({
        data: {
          code, customerId: customer.id, orderDate: day(offset), source: 'demo',
          status: offset + 2 <= 0 ? 'DELIVERED' : 'CONFIRMED',
          deliveredAt: offset + 2 <= 0 ? deliveredAt : null,
          totalAmount: lines.reduce((a, l) => a + l.amount, 0),
          items: { create: lines },
        },
      });
      await prisma.activity.create({
        data: {
          customerId: customer.id, type: 'ORDER', occurredAt: day(offset), metadata: { orderId: order.id },
          content: `Đơn hàng ${code}: ${lines.length} mặt hàng, ${Number(order.totalAmount).toLocaleString('vi-VN')} đ`,
        },
      });
    }
  }

  // Interactions and tickets
  const c1 = await prisma.customer.findUniqueOrThrow({ where: { code: 'DEMO-001' } });
  const c3 = await prisma.customer.findUniqueOrThrow({ where: { code: 'DEMO-003' } });
  if ((await prisma.activity.count({ where: { type: { in: ['CALL', 'VISIT'] } } })) === 0) {
    await prisma.activity.createMany({
      data: [
        { customerId: c1.id, userId: users.sale1.id, type: 'VISIT', outcome: 'POSITIVE', content: 'Thăm nhà máy, khách chuẩn bị mở thêm line SMT – nhu cầu găng ESD tăng 30% từ quý sau.', occurredAt: day(-6) },
        { customerId: c3.id, userId: users.sale2.id, type: 'CALL', outcome: 'NEUTRAL', content: 'Gọi nhắc công nợ, kế toán hẹn thanh toán cuối tháng.', occurredAt: day(-12) },
      ],
    });
    await prisma.customer.update({ where: { id: c1.id }, data: { lastActivityAt: day(-6) } });
    await prisma.customer.update({ where: { id: c3.id }, data: { lastActivityAt: day(-12) } });
  }
  if ((await prisma.ticket.count()) === 0) {
    const created = new Date(Date.now() - 30 * 3600 * 1000);
    await prisma.ticket.create({
      data: {
        customerId: c3.id, subject: 'Lô găng chống cắt bị bung chỉ ở ngón cái', category: 'QUALITY', priority: 'HIGH',
        description: 'Khách phản ánh 5% găng lô tháng này bung đường may sau 2 ca. Yêu cầu đổi hàng + báo cáo 8D.',
        assigneeId: users.sale2.id, createdAt: created, slaDueAt: new Date(created.getTime() + 8 * 3600 * 1000),
      },
    });
  }

  console.log(`Seed done. Users (password: ${PASSWORD}):`);
  console.table(Object.values(users).map((u) => ({ email: u.email, role: u.role })));
}

function upsertUser(email: string, name: string, role: 'ADMIN' | 'MANAGER' | 'AGENT', passwordHash: string) {
  return prisma.user.upsert({ where: { email }, create: { email, name, role, passwordHash }, update: { name, role } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
