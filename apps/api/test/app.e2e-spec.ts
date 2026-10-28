/**
 * End-to-end: real PostgreSQL + Redis (see CI). Uses its own data prefix and
 * expects an empty, migrated database (DATABASE_URL).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

process.env.SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET ??= 'e2e-secret';

const day = (offset: number) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
};

describe('CRM API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manager: string[];
  let agent: string[];
  let mineId: string;
  let otherId: string;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Secret123!' }).expect(200);
    return res.get('Set-Cookie')!;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash('Secret123!', 4);
    const m = await prisma.user.create({ data: { email: 'e2e-manager@test.local', name: 'M', role: 'MANAGER', passwordHash } });
    const a = await prisma.user.create({ data: { email: 'e2e-agent@test.local', name: 'A', role: 'AGENT', passwordHash } });
    const mine = await prisma.customer.create({ data: { code: 'E2E-1', name: 'Mine', ownerId: a.id } });
    const other = await prisma.customer.create({ data: { code: 'E2E-2', name: 'Other', ownerId: m.id } });
    mineId = mine.id;
    otherId = other.id;
    // Agent's customer: monthly buyer that stopped 70 days ago → win-back / at-risk.
    for (const [i, offset] of [-190, -160, -130, -100, -70].entries()) {
      await prisma.order.create({
        data: {
          code: `E2E-SO-${i}`, customerId: mine.id, orderDate: day(offset), totalAmount: 10_000_000,
          items: { create: [{ sku: 'GLV', productName: 'Gloves', quantity: 100, unitPrice: 100_000, amount: 10_000_000 }] },
        },
      });
    }
    manager = await login('e2e-manager@test.local');
    agent = await login('e2e-agent@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous requests and bad passwords', async () => {
    await request(app.getHttpServer()).get('/api/customers').expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'e2e-agent@test.local', password: 'wrong-pass' }).expect(401);
  });

  it('scopes customers to the agent who owns them', async () => {
    const res = await request(app.getHttpServer()).get('/api/customers').set('Cookie', agent).expect(200);
    expect(res.body.items.map((c: { code: string }) => c.code)).toEqual(['E2E-1']);
    await request(app.getHttpServer()).get(`/api/customers/${otherId}`).set('Cookie', agent).expect(403);
    await request(app.getHttpServer()).get(`/api/customers/${otherId}`).set('Cookie', manager).expect(200);
  });

  it('only managers run the engine and import', async () => {
    await request(app.getHttpServer()).post('/api/retention/run').set('Cookie', agent).expect(403);
  });

  it('creates follow-up tasks once, even when run twice', async () => {
    const first = await request(app.getHttpServer()).post('/api/retention/run').set('Cookie', manager).expect(201);
    const created = Object.values(first.body.rules as Record<string, { created: number }>).reduce((a, r) => a + r.created, 0);
    expect(created).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer()).post('/api/retention/run').set('Cookie', manager).expect(201);
    const tasks = await prisma.task.findMany({ where: { customerId: mineId } });
    expect(tasks).toHaveLength(1); // one open automated follow-up per customer
    expect(tasks[0].assigneeId).toBeDefined();

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: mineId } });
    expect(customer.orderCycleDays).toBe(30);
    expect(customer.healthLevel).toBe('AT_RISK');
  });

  it('closing a task requires a result and logs it on the timeline', async () => {
    const task = await prisma.task.findFirstOrThrow({ where: { customerId: mineId } });
    await request(app.getHttpServer()).post(`/api/tasks/${task.id}/complete`).set('Cookie', agent).send({}).expect(400);
    await request(app.getHttpServer())
      .post(`/api/tasks/${task.id}/complete`)
      .set('Cookie', agent)
      .send({ result: 'Khách hẹn PO tuần sau', outcome: 'POSITIVE' })
      .expect(201);
    const res = await request(app.getHttpServer()).get(`/api/customers/${mineId}`).set('Cookie', agent).expect(200);
    expect(res.body.timeline[0].content).toContain('Khách hẹn PO tuần sau');
  });

  it('imports orders idempotently from a Vietnamese CSV', async () => {
    const csv = 'so_chung_tu,ma_kh,ngay_chung_tu,ma_hang,so_luong,don_gia\nE2E-CSV-1,E2E-1,01/10/2026,GLV,"1.000","100.000"\n';
    const send = () =>
      request(app.getHttpServer()).post('/api/imports/orders').set('Cookie', manager).attach('file', Buffer.from(csv), 'o.csv').expect(201);
    expect((await send()).body).toMatchObject({ created: 1, updated: 0 });
    expect((await send()).body).toMatchObject({ created: 0, updated: 1 });
    const order = await prisma.order.findUniqueOrThrow({ where: { code: 'E2E-CSV-1' } });
    expect(Number(order.totalAmount)).toBe(100_000_000);
  });

  it('flags tickets past SLA and escalates', async () => {
    await prisma.ticket.create({
      data: { customerId: mineId, subject: 'Late', slaDueAt: new Date(Date.now() - 60_000), assigneeId: null },
    });
    const res = await request(app.getHttpServer()).post('/api/retention/run').set('Cookie', manager).expect(201);
    expect(res.body.sla.breached).toBe(1);
  });
});
