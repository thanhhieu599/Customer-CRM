import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
process.env.SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET ??= 'e2e-secret';
const future = (days = 2) => new Date(Date.now() + days * 86400000).toISOString();
const line = { sku: 'P1-GLV', productName: 'Găng tay chống cắt', unit: 'đôi', quantity: '2.5', unitPrice: '100.01' };
const quoteBody = () => ({
  items: [line],
  discountAmount: '10.03',
  vatPercent: '8',
  validUntil: future(14).slice(0, 10),
  followUpAt: future(),
});
describe('Phase 1 sales workspace (real PostgreSQL + Redis)', () => {
  let app: INestApplication, prisma: PrismaService;
  let manager: string[], agent: string[], other: string[];
  let managerId: string,
    agentId: string,
    otherId: string,
    customerId: string,
    foreignId: string,
    oppId: string,
    quoteId: string;
  const ids: string[] = [];
  const http = () => request(app.getHttpServer());
  const createOpp = (id = customerId) =>
    http()
      .post('/api/opportunities')
      .set('Cookie', agent)
      .send({
        customerId: id,
        title: 'P1 Găng tay định kỳ',
        value: '1000000',
        expectedCloseAt: future(30).slice(0, 10),
        nextActionAt: future(),
      });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash('Phase1Test!', 4);
    for (const [email, role, name] of [
      ['p1-manager@test.local', 'MANAGER', 'M'],
      ['p1-agent@test.local', 'AGENT', 'A'],
      ['p1-other@test.local', 'AGENT', 'B'],
    ] as const) {
      const u = await prisma.user.create({ data: { email, role, name, passwordHash } });
      if (role === 'MANAGER') managerId = u.id;
      else if (name === 'A') agentId = u.id;
      else otherId = u.id;
    }
    const login = async (email: string) =>
      (await http().post('/api/auth/login').send({ email, password: 'Phase1Test!' }).expect(200)).get('Set-Cookie')!;
    manager = await login('p1-manager@test.local');
    agent = await login('p1-agent@test.local');
    other = await login('p1-other@test.local');
    const mine = await prisma.customer.create({
        data: { code: 'P1-MINE', name: 'Công ty kiểm thử Một', ownerId: agentId },
      }),
      foreign = await prisma.customer.create({
        data: { code: 'P1-FOREIGN', name: 'Công ty kiểm thử Hai', ownerId: otherId },
      });
    customerId = mine.id;
    foreignId = foreign.id;
    ids.push(mine.id, foreign.id);
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.quote.deleteMany({ where: { opportunity: { customerId: { in: ids } } } });
      await prisma.opportunity.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.customer.updateMany({ where: { id: { in: ids } }, data: { mergedIntoId: null } });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: [managerId, agentId, otherId] } } });
    }
    if (app) await app.close();
  });
  it('enforces authentication and customer ownership for create and list', async () => {
    await http().get('/api/opportunities').expect(401);
    await createOpp(foreignId).expect(403);
    const created = await createOpp().expect(201);
    oppId = created.body.id;
    expect((await http().get('/api/opportunities').set('Cookie', other).expect(200)).body.items).toEqual([]);
    await http().get(`/api/opportunities/${oppId}`).set('Cookie', other).expect(403);
    const customers = await http().get(`/api/customers?ownerId=${otherId}`).set('Cookie', agent).expect(200);
    expect(customers.body.items.map((c: { id: string }) => c.id)).toContain(customerId);
    expect(customers.body.items.map((c: { id: string }) => c.id)).not.toContain(foreignId);
    await http().patch(`/api/customers/${customerId}`).set('Cookie', agent).send({ ownerId: otherId }).expect(403);
  });
  it('rejects whitespace, null updates, malformed dates and excessive bulk selections', async () => {
    await http()
      .post('/api/opportunities')
      .set('Cookie', agent)
      .send({ customerId, title: '   ', value: '1', expectedCloseAt: future(), nextActionAt: future() })
      .expect(400);
    await http()
      .patch(`/api/opportunities/${oppId}`)
      .set('Cookie', agent)
      .send({ version: 1, stage: null })
      .expect(400);
    await http()
      .patch(`/api/opportunities/${oppId}`)
      .set('Cookie', agent)
      .send({ version: 1, nextActionAt: 'not-a-date' })
      .expect(400);
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', manager)
      .send({ ids: Array.from({ length: 101 }, () => customerId), action: 'tag', tags: ['P1-limit'] })
      .expect(400);
    await http()
      .post('/api/saved-filters')
      .set('Cookie', agent)
      .send({ name: 'Invalid filter', filters: { lastContactDays: -1 } })
      .expect(400);
  });
  it('requires a loss reason and rejects stale opportunity versions', async () => {
    await http()
      .patch(`/api/opportunities/${oppId}`)
      .set('Cookie', agent)
      .send({ version: 1, stage: 'LOST' })
      .expect(400);
    await http()
      .patch(`/api/opportunities/${oppId}`)
      .set('Cookie', agent)
      .send({ version: 1, stage: 'QUALIFIED' })
      .expect(200);
    await http()
      .patch(`/api/opportunities/${oppId}`)
      .set('Cookie', agent)
      .send({ version: 1, stage: 'NEGOTIATION' })
      .expect(409);
  });
  it('validates quote inputs and computes totals on the server', async () => {
    await http()
      .post(`/api/opportunities/${oppId}/quotes`)
      .set('Cookie', agent)
      .send({ ...quoteBody(), items: [{ ...line, quantity: '0' }] })
      .expect(400);
    await http()
      .post(`/api/opportunities/${oppId}/quotes`)
      .set('Cookie', agent)
      .send({ ...quoteBody(), vatPercent: '101' })
      .expect(400);
    await http()
      .post(`/api/opportunities/${oppId}/quotes`)
      .set('Cookie', agent)
      .send({ ...quoteBody(), validUntil: '2020-01-01' })
      .expect(400);
    const res = await http()
      .post(`/api/opportunities/${oppId}/quotes`)
      .set('Cookie', agent)
      .send({ ...quoteBody(), total: '1' })
      .expect(201);
    quoteId = res.body.id;
    expect(res.body.total).toBe('259.2');
    expect(res.body.customerSnapshot.name).toBe('Công ty kiểm thử Một');
    await http().post(`/api/opportunities/${oppId}/quotes`).set('Cookie', agent).send(quoteBody()).expect(409);
  });
  it('returns a real PDF, embeds a font and protects quote access', async () => {
    const res = await http()
      .get(`/api/quotes/${quoteId}/pdf`)
      .set('Cookie', agent)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.toString('latin1')).toContain('/FontFile2');
    await http().get(`/api/quotes/${quoteId}/pdf`).set('Cookie', other).expect(403);
  });
  it('atomically sends once and creates exactly one linked reminder under concurrent requests', async () => {
    const results = await Promise.all(
      [1, 2].map(() => http().patch(`/api/quotes/${quoteId}/status`).set('Cookie', agent).send({ status: 'SENT' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual(expect.arrayContaining([200]));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => [200, 400, 409].includes(r.status))).toBe(true);
    expect(await prisma.task.count({ where: { quoteId } })).toBe(1);
    const task = await prisma.task.findUniqueOrThrow({ where: { quoteId } });
    expect(task.assigneeId).toBe(agentId);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } })).stage).toBe('QUOTED');
  });
  it('preserves old versions and replaces their reminders only when the new version is sent', async () => {
    const second = await http()
      .post(`/api/opportunities/${oppId}/quotes`)
      .set('Cookie', agent)
      .send({ ...quoteBody(), items: [{ ...line, unitPrice: '200' }] })
      .expect(201);
    expect(second.body.version).toBe(2);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe('SENT');
    await http().patch(`/api/quotes/${quoteId}/status`).set('Cookie', agent).send({ status: 'SENT' }).expect(400);
    await http()
      .patch(`/api/quotes/${second.body.id}/status`)
      .set('Cookie', agent)
      .send({ status: 'SENT' })
      .expect(200);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe('SUPERSEDED');
    expect((await prisma.task.findUniqueOrThrow({ where: { quoteId } })).status).toBe('CANCELED');
    quoteId = second.body.id;
  });
  it('can accept the still-active sent version while a newer draft exists', async () => {
    const opp = (await createOpp().expect(201)).body;
    const first = (
      await http().post(`/api/opportunities/${opp.id}/quotes`).set('Cookie', agent).send(quoteBody()).expect(201)
    ).body;
    await http().patch(`/api/quotes/${first.id}/status`).set('Cookie', agent).send({ status: 'SENT' }).expect(200);
    const draft = (
      await http().post(`/api/opportunities/${opp.id}/quotes`).set('Cookie', agent).send(quoteBody()).expect(201)
    ).body;
    await http().patch(`/api/quotes/${first.id}/status`).set('Cookie', agent).send({ status: 'ACCEPTED' }).expect(200);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('SUPERSEDED');
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stage).toBe('WON');
  });
  it('shows due quotes and opportunities in the daily workspace without leaking another owner', async () => {
    const past = new Date(Date.now() - 60000);
    await prisma.quote.update({ where: { id: quoteId }, data: { followUpAt: past } });
    await prisma.opportunity.update({ where: { id: oppId }, data: { nextActionAt: past } });
    await prisma.task.update({ where: { quoteId }, data: { dueAt: past } });
    const day = await http().get('/api/workbench').set('Cookie', agent).expect(200);
    expect(day.body.quotes.map((q: { id: string }) => q.id)).toContain(quoteId);
    expect(day.body.opportunities.map((o: { id: string }) => o.id)).toContain(oppId);
    expect(day.body.tasks.some((t: { quoteId: string }) => t.quoteId === quoteId)).toBe(true);
    const foreign = await http().get('/api/workbench').set('Cookie', other).expect(200);
    expect(foreign.body.quotes).toEqual([]);
    expect(foreign.body.opportunities).toEqual([]);
  });
  it('requires an actual outcome before completing a linked follow-up', async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { quoteId } });
    await http().post(`/api/tasks/${task.id}/complete`).set('Cookie', agent).send({}).expect(400);
    await http().patch(`/api/tasks/${task.id}`).set('Cookie', agent).send({ status: 'DONE' }).expect(400);
    await http().post(`/api/tasks/${task.id}/complete`).set('Cookie', agent).send({ result: '   ' }).expect(400);
    await http()
      .post(`/api/tasks/${task.id}/complete`)
      .set('Cookie', agent)
      .send({ result: 'Khách yêu cầu gọi lại vào ngày mai', outcome: 'NEUTRAL' })
      .expect(201);
    expect(await prisma.activity.count({ where: { customerId, content: { contains: 'Khách yêu cầu gọi lại' } } })).toBe(
      1,
    );
    await http()
      .post(`/api/tasks/${task.id}/complete`)
      .set('Cookie', agent)
      .send({ result: 'Lặp kết quả' })
      .expect(409);
    await prisma.task.update({ where: { id: task.id }, data: { status: 'OPEN', completedAt: null } });
  });
  it('rejects arbitrary quote transitions and prevents nonowners from editing prices', async () => {
    await http().patch(`/api/quotes/${quoteId}/status`).set('Cookie', agent).send({ status: 'SUPERSEDED' }).expect(400);
    await http().post(`/api/opportunities/${oppId}/quotes`).set('Cookie', other).send(quoteBody()).expect(403);
  });
  it('accepts a quote, closes the opportunity and cancels its reminder without inventing an order', async () => {
    await http().patch(`/api/quotes/${quoteId}/status`).set('Cookie', agent).send({ status: 'ACCEPTED' }).expect(200);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } })).stage).toBe('WON');
    expect((await prisma.task.findUniqueOrThrow({ where: { quoteId } })).status).toBe('CANCELED');
    expect(await prisma.order.count({ where: { customerId } })).toBe(0);
    await http().post(`/api/opportunities/${oppId}/quotes`).set('Cookie', agent).send(quoteBody()).expect(400);
  });
  it('persists private saved filters and updates the same name without duplication', async () => {
    const f = await http()
      .post('/api/saved-filters')
      .set('Cookie', agent)
      .send({ name: 'Khách cần chăm', filters: { q: 'kiểm thử', lastContactDays: '30', sort: 'name', page: 3 } })
      .expect(201);
    expect(f.body.filters.lastContactDays).toBe(30);
    expect(f.body.filters.page).toBeUndefined();
    await http()
      .post('/api/saved-filters')
      .set('Cookie', agent)
      .send({ name: 'Khách cần chăm', filters: { segment: 'VIP' } })
      .expect(201);
    expect((await http().get('/api/saved-filters').set('Cookie', agent).expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/saved-filters').set('Cookie', other).expect(200)).body).toEqual([]);
    await http().delete(`/api/saved-filters/${f.body.id}`).set('Cookie', other).expect(404);
  });
  it('rolls back a bulk action when any selected customer is inaccessible', async () => {
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', agent)
      .send({ ids: [customerId, foreignId], action: 'tag', tags: ['P1-check'] })
      .expect(403);
    expect(await prisma.customerTagRelation.count({ where: { customerId } })).toBe(0);
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', agent)
      .send({ ids: [customerId], action: 'assign', assigneeId: otherId })
      .expect(403);
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', manager)
      .send({ ids: [customerId], action: 'assign' })
      .expect(400);
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', manager)
      .send({ ids: [customerId, customerId], action: 'tag', tags: ['P1-check'] })
      .expect(400);
  });
  it('rejects assignment to disabled users without moving any customer', async () => {
    await prisma.user.update({ where: { id: otherId }, data: { isActive: false } });
    try {
      await http()
        .post('/api/customers/bulk')
        .set('Cookie', manager)
        .send({ ids: [customerId], action: 'assign', assigneeId: otherId })
        .expect(400);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).ownerId).toBe(agentId);
    } finally {
      await prisma.user.update({ where: { id: otherId }, data: { isActive: true } });
    }
  });
  it('adds tags idempotently and creates a task for every selected customer', async () => {
    for (let i = 0; i < 2; i++)
      await http()
        .post('/api/customers/bulk')
        .set('Cookie', agent)
        .send({ ids: [customerId], action: 'tag', tags: ['P1-check', 'P1-check'] })
        .expect(201);
    expect(await prisma.customerTagRelation.count({ where: { customerId } })).toBe(1);
    const res = await http()
      .post('/api/customers/bulk')
      .set('Cookie', manager)
      .send({ ids: [customerId, foreignId], action: 'task', title: 'P1 Chăm sóc theo đợt', dueAt: future() })
      .expect(201);
    expect(res.body.count).toBe(2);
    expect(
      await prisma.task.count({
        where: { customerId: { in: [customerId, foreignId] }, title: 'P1 Chăm sóc theo đợt' },
      }),
    ).toBe(2);
  });
  it('transfers access to opportunities and PDFs when the customer owner changes', async () => {
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', manager)
      .send({ ids: [customerId], action: 'assign', assigneeId: otherId })
      .expect(201);
    await http().get(`/api/opportunities/${oppId}`).set('Cookie', agent).expect(403);
    await http().get(`/api/quotes/${quoteId}/pdf`).set('Cookie', other).expect(200);
    await http()
      .post('/api/customers/bulk')
      .set('Cookie', manager)
      .send({ ids: [customerId], action: 'assign', assigneeId: agentId })
      .expect(201);
  });
  let sourceId: string, targetId: string;
  it('detects normalized duplicate identities but forbids agents from scanning or merging', async () => {
    const target = await prisma.customer.create({
      data: {
        code: 'P1-TARGET',
        name: 'Công ty Đại Phát',
        phone: '0901234567',
        email: 'buyer@p1.test',
        ownerId: agentId,
        marketingConsent: true,
      },
    });
    const source = await prisma.customer.create({
      data: {
        code: 'P1-SOURCE',
        name: 'Cong ty Dai Phat',
        phone: '+84 901 234 567',
        email: 'BUYER@P1.TEST',
        ownerId: otherId,
        marketingConsent: false,
        notes: 'Thông tin từ hồ sơ nguồn',
      },
    });
    sourceId = source.id;
    targetId = target.id;
    ids.push(sourceId, targetId);
    await http().get('/api/customer-duplicates').set('Cookie', agent).expect(403);
    await http().post('/api/customer-duplicates/preview').set('Cookie', agent).send({ sourceId, targetId }).expect(403);
    const res = await http().get('/api/customer-duplicates').set('Cookie', manager).expect(200);
    expect(
      res.body.items.some(
        (p: { source: { id: string }; target: { id: string } }) =>
          [p.source.id, p.target.id].includes(sourceId) && [p.source.id, p.target.id].includes(targetId),
      ),
    ).toBe(true);
  });
  it('rejects stale merge previews and conflicting tax codes', async () => {
    const preview = await http()
      .post('/api/customer-duplicates/preview')
      .set('Cookie', manager)
      .send({ sourceId, targetId })
      .expect(201);
    await prisma.customer.update({ where: { id: sourceId }, data: { phone: '0901 234 567' } });
    await http()
      .post('/api/customer-duplicates/merge')
      .set('Cookie', manager)
      .send({ sourceId, targetId, token: preview.body.token })
      .expect(409);
    await prisma.customer.update({ where: { id: sourceId }, data: { taxCode: 'P1-TAX-1' } });
    await prisma.customer.update({ where: { id: targetId }, data: { taxCode: 'P1-TAX-2' } });
    const conflict = await http()
      .post('/api/customer-duplicates/preview')
      .set('Cookie', manager)
      .send({ sourceId, targetId })
      .expect(201);
    expect(conflict.body.taxConflict).toBe(true);
    await http()
      .post('/api/customer-duplicates/merge')
      .set('Cookie', manager)
      .send({ sourceId, targetId, token: conflict.body.token })
      .expect(400);
    await prisma.customer.update({ where: { id: sourceId }, data: { taxCode: null } });
    await prisma.customer.update({ where: { id: targetId }, data: { taxCode: null } });
  });
  it('requires two distinct, related customer records for a merge', async () => {
    await http()
      .post('/api/customer-duplicates/preview')
      .set('Cookie', manager)
      .send({ sourceId, targetId: sourceId })
      .expect(400);
    await http()
      .post('/api/customer-duplicates/preview')
      .set('Cookie', manager)
      .send({ sourceId: customerId, targetId: foreignId })
      .expect(400);
  });
  it('preserves contacts, orders, activities, tasks, tickets, tags, sales and mappings in an audited merge', async () => {
    const contact = await prisma.customerContact.create({
      data: { customerId: sourceId, name: 'Người mua hàng', isPrimary: true },
    });
    await prisma.order.create({
      data: {
        code: 'P1-ORDER',
        customerId: sourceId,
        orderDate: new Date(),
        totalAmount: '123456.78',
        items: { create: [{ sku: 'P1', productName: 'Test', quantity: 1, amount: '123456.78' }] },
      },
    });
    await prisma.activity.create({
      data: { customerId: sourceId, contactId: contact.id, type: 'CALL', content: 'P1 Lịch sử giữ nguyên' },
    });
    await prisma.task.create({
      data: { customerId: sourceId, title: 'P1 Task source', dueAt: new Date(), assigneeId: otherId },
    });
    await prisma.ticket.create({
      data: { customerId: sourceId, contactId: contact.id, subject: 'P1 Ticket', slaDueAt: future() },
    });
    const tag = await prisma.customerTag.findFirstOrThrow({ where: { name: 'P1-check' } });
    await prisma.customerTagRelation.createMany({
      data: [
        { customerId: sourceId, tagId: tag.id },
        { customerId: targetId, tagId: tag.id },
      ],
    });
    await prisma.opportunity.create({
      data: {
        customerId: sourceId,
        title: 'P1 Source opportunity',
        value: 100,
        expectedCloseAt: new Date(),
        nextActionAt: new Date(),
      },
    });
    await prisma.externalIdMapping.create({
      data: { system: 'p1erp', entityType: 'customer', externalId: 'P1-SOURCE', entityId: sourceId },
    });
    const p = await http()
      .post('/api/customer-duplicates/preview')
      .set('Cookie', manager)
      .send({ sourceId, targetId })
      .expect(201);
    expect(p.body.counts.orders).toBe(1);
    await http()
      .post('/api/customer-duplicates/merge')
      .set('Cookie', manager)
      .send({ sourceId, targetId, token: p.body.token })
      .expect(201);
    const target = await prisma.customer.findUniqueOrThrow({
      where: { id: targetId },
      include: {
        contacts: true,
        orders: true,
        tasks: true,
        tickets: true,
        tags: true,
        opportunities: true,
        activities: true,
      },
    });
    expect(target.contacts.map((c) => c.id)).toContain(contact.id);
    expect(target.orders).toHaveLength(1);
    expect(target.tasks).toHaveLength(1);
    expect(target.tickets[0].contactId).toBe(contact.id);
    expect(target.tags).toHaveLength(1);
    expect(target.opportunities).toHaveLength(1);
    expect(target.activities.some((a) => a.content === 'P1 Lịch sử giữ nguyên')).toBe(true);
    expect(target.revenueTotal.toString()).toBe('123456.78');
    expect(target.healthScore).not.toBeNull();
    expect(target.marketingConsent).toBe(false);
    expect(target.notes).toContain('Thông tin từ hồ sơ nguồn');
    const source = await prisma.customer.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.deletedAt).not.toBeNull();
    expect(source.mergedIntoId).toBe(targetId);
    expect(
      (await prisma.externalIdMapping.findFirstOrThrow({ where: { system: 'p1erp', externalId: 'P1-SOURCE' } }))
        .entityId,
    ).toBe(targetId);
    expect(await prisma.auditLog.count({ where: { entityId: targetId, action: 'merge' } })).toBe(1);
    await http().get(`/api/customers/${sourceId}`).set('Cookie', manager).expect(404);
    await http()
      .post('/api/customer-duplicates/merge')
      .set('Cookie', manager)
      .send({ sourceId, targetId, token: p.body.token })
      .expect(404);
  });
  it('follows merge aliases when importing the old code from a different system', async () => {
    const csv =
      'so_chung_tu,ma_kh,ngay_chung_tu,ma_hang,so_luong,don_gia\nP1-ALIAS-ORDER,P1-SOURCE,30/10/2026,GLV,1,100\n';
    const res = await http()
      .post('/api/imports/orders?system=sapo')
      .set('Cookie', manager)
      .attach('file', Buffer.from(csv), 'orders.csv')
      .expect(201);
    expect(res.body.errors).toEqual([]);
    expect((await prisma.order.findUniqueOrThrow({ where: { code: 'P1-ALIAS-ORDER' } })).customerId).toBe(targetId);
  });
});
