'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Building2, Lightbulb, Mail, Phone, UserPlus } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { date, dateTime, daysAgo, money, vnd } from '@/lib/format';
import {
  ACTIVITY_TYPE, CONTACT_ROLE, HEALTH, OUTCOME, PRIORITY, REORDER_STATUS, SEGMENT, TASK_TYPE, TICKET_CATEGORY, TICKET_STATUS,
} from '@/lib/labels';
import { useMe, useUsers } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Empty, ErrorBox, Loading } from '@/components/ui/misc';
import { CompleteTaskDialog } from '@/components/complete-task';
import { LogActivity } from '@/components/log-activity';

interface Customer360 {
  customer: {
    id: string; code: string; name: string; taxCode: string | null; industry: string | null; tier: string | null; source: string | null;
    phone: string | null; email: string | null; address: string | null; notes: string | null;
    segment: string; healthScore: number | null; healthLevel: string | null;
    healthReasons: { reasons: string[]; breakdown: Record<string, number> } | null; healthUpdatedAt: string | null;
    orderCount: number; lastOrderAt: string | null; orderCycleDays: number | null;
    revenueTotal: string; revenue12m: string; revenuePrev12m: string; overdueDebtDays: number | null;
    owner: { id: string; name: string } | null;
    contacts: { id: string; name: string; title: string | null; role: string; phone: string | null; email: string | null; isPrimary: boolean; isDecisionMaker: boolean; leftCompanyAt: string | null }[];
    tags: { tag: { name: string } }[];
  };
  timeline: { id: string; type: string; outcome: string | null; content: string; occurredAt: string; user: { name: string } | null; contact: { name: string } | null }[];
  openTasks: { id: string; title: string; type: string; priority: string; dueAt: string; description: string | null; assignee: { name: string } | null }[];
  tickets: { id: string; number: number; subject: string; status: string; category: string; slaBreached: boolean; createdAt: string }[];
  orders: { id: string; code: string; orderDate: string; status: string; totalAmount: string; items: { sku: string; productName: string; quantity: string }[] }[];
  forecasts: { sku: string; productName: string; cycleDays: number; lastOrderDate: string; predictedNextDate: string; daysUntilDue: number; status: string; confidence: string; suggestedQuantity: number | null; orderCount: number }[];
}

const BREAKDOWN_LABEL: Record<string, [string, number]> = {
  recency: ['Mua đúng chu kỳ', 35],
  trend: ['Xu hướng doanh thu', 20],
  service: ['Khiếu nại', 20],
  payment: ['Công nợ', 15],
  engagement: ['Tương tác 30 ngày', 10],
};

/** Plain-language next best action from the computed signals (rule-based). */
function suggestion(d: Customer360): string {
  const c = d.customer;
  const ago = daysAgo(c.lastOrderAt);
  const due = d.forecasts.filter((f) => f.status === 'dueSoon' || f.status === 'overdue');
  if (d.tickets.some((t) => !['RESOLVED', 'CLOSED'].includes(t.status)))
    return 'Ưu tiên xử lý dứt điểm ticket đang mở và cập nhật tiến độ cho khách trước khi chào hàng mới.';
  if (c.segment === 'DORMANT') return 'Khách ngủ đông: gọi hỏi lý do ngừng mua, đề xuất mẫu thử / ưu đãi quay lại, cập nhật người liên hệ.';
  if (c.healthLevel === 'AT_RISK') return 'Nguy cơ rời bỏ: hẹn gặp Purchasing + EHS trong tuần, tìm hiểu đối thủ / thay đổi nhu cầu.';
  if (due.length) return `Sắp đến kỳ đặt hàng ${due.map((f) => f.productName).join(', ')} – liên hệ xác nhận nhu cầu và gửi báo giá giữ giá.`;
  if (ago !== null && c.orderCycleDays && ago > c.orderCycleDays) return 'Khách đã quá chu kỳ mua thường lệ. Ưu tiên liên hệ hỏi nhu cầu nhập hàng tiếp theo.';
  if (c.overdueDebtDays) return `Công nợ quá hạn ${c.overdueDebtDays} ngày – phối hợp kế toán nhắc thanh toán, tránh ảnh hưởng quan hệ.`;
  return 'Khách đang ổn định: duy trì chăm sóc định kỳ, giới thiệu sản phẩm bổ sung (cross-sell) phù hợp ngành.';
}

export default function Customer360Page() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading, mutate } = useSWR<Customer360>(`/customers/${id}`, fetcher);
  const { isManager } = useMe();
  const users = useUsers();
  const [completing, setCompleting] = useState<{ id: string; title: string } | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [careOnly, setCareOnly] = useState(false);

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Loading />;
  const c = data.customer;
  const ago = daysAgo(c.lastOrderAt);
  const h = HEALTH[c.healthLevel ?? ''];

  async function patch(body: Record<string, unknown>) {
    await api(`/customers/${id}`, 'PATCH', body);
    mutate();
  }

  return (
    <>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{c.name}</h1>
            <Badge tone={SEGMENT[c.segment].tone}>{SEGMENT[c.segment].label}</Badge>
            {c.tier && <Badge tone="violet">Hạng {c.tier}</Badge>}
            {c.tags.map((t) => (
              <Badge key={t.tag.name}>#{t.tag.name}</Badge>
            ))}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {c.code}
            {c.taxCode && ` · MST ${c.taxCode}`}
            {c.industry && ` · ${c.industry}`}
            {c.address && ` · ${c.address}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/opportunities?customerId=${id}`} className="rounded border px-3 py-2 text-primary hover:bg-muted">Cơ hội & Báo giá</Link>
          <span className="text-muted-foreground">Phụ trách</span>
          {isManager ? (
            <Select value={c.owner?.id ?? ''} onChange={(e) => patch({ ownerId: e.target.value || null })} className="w-48" aria-label="Người phụ trách">
              <option value="">— Chưa giao —</option>
              {users.filter((u) => u.isActive).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="font-medium">{c.owner?.name ?? '—'}</span>
          )}
          {isManager && (
            <Select value={c.tier ?? ''} onChange={(e) => patch({ tier: e.target.value || null })} className="w-28" aria-label="Hạng khách">
              <option value="">Hạng —</option>
              <option value="A">Hạng A</option>
              <option value="B">Hạng B</option>
              <option value="C">Hạng C</option>
            </Select>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Đơn hàng', c.orderCount],
          ['Doanh thu 12 tháng', money(c.revenue12m)],
          ['Tổng đã mua', money(c.revenueTotal)],
          ['Lần mua gần nhất', ago === null ? '—' : `${ago} ngày`],
          ['Chu kỳ mua', c.orderCycleDays ? `≈${c.orderCycleDays} ngày` : '—'],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex gap-3 p-4">
              <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-semibold">Gợi ý chăm sóc</div>
                <p className="mt-0.5 text-sm">{suggestion(data)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Việc đang mở ({data.openTasks.length})</CardTitle>
            </CardHeader>
            {data.openTasks.length === 0 ? (
              <Empty>Không có việc đang mở.</Empty>
            ) : (
              <ul className="divide-y">
                {data.openTasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <Badge>{TASK_TYPE[t.type]}</Badge>
                        <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                        <span className={new Date(t.dueAt) < new Date() ? 'font-medium text-rose-600' : ''}>Hạn {dateTime(t.dueAt)}</span>
                        <span>· {t.assignee?.name ?? 'Chưa giao'}</span>
                      </div>
                      {t.description && <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-muted-foreground">{t.description}</pre>}
                    </div>
                    <Button size="sm" onClick={() => setCompleting(t)}>
                      Hoàn thành
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dự báo đặt hàng lại theo mã hàng</CardTitle>
            </CardHeader>
            {data.forecasts.length === 0 ? (
              <Empty>Cần ít nhất 2 lần mua cùng mã hàng để dự báo.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Mã hàng</Th>
                    <Th>Chu kỳ</Th>
                    <Th>Mua gần nhất</Th>
                    <Th>Dự kiến đặt lại</Th>
                    <Th className="text-right">SL gợi ý</Th>
                    <Th>Trạng thái</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecasts.map((f) => (
                    <Tr key={f.sku}>
                      <Td>
                        <div className="font-medium">{f.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          {f.sku} · {f.orderCount} lần mua · tin cậy {f.confidence}
                        </div>
                      </Td>
                      <Td>≈{f.cycleDays} ngày</Td>
                      <Td>{date(f.lastOrderDate)}</Td>
                      <Td>
                        {date(f.predictedNextDate)}
                        <div className="text-xs text-muted-foreground">{f.daysUntilDue >= 0 ? `còn ${f.daysUntilDue} ngày` : `trễ ${-f.daysUntilDue} ngày`}</div>
                      </Td>
                      <Td className="text-right tabular-nums">{f.suggestedQuantity?.toLocaleString('vi-VN') ?? '—'}</Td>
                      <Td>
                        <Badge tone={REORDER_STATUS[f.status].tone}>{REORDER_STATUS[f.status].label}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dòng thời gian chăm sóc</CardTitle>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={careOnly} onChange={(e) => setCareOnly(e.target.checked)} /> Ẩn đơn hàng
              </label>
            </CardHeader>
            <CardContent>
              <LogActivity customerId={id} contacts={c.contacts} onSaved={() => mutate()} />
              <ol className="mt-4 space-y-3 border-l pl-4">
                {data.timeline.length === 0 && <Empty>Chưa có tương tác.</Empty>}
                {data.timeline
                  .filter((a) => !careOnly || a.type !== 'ORDER')
                  .slice(0, showAll ? undefined : 15)
                  .map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{ACTIVITY_TYPE[a.type]}</span>
                      {a.outcome && <Badge tone={OUTCOME[a.outcome].tone}>{OUTCOME[a.outcome].label}</Badge>}
                      <span>{a.type === 'ORDER' ? date(a.occurredAt) : dateTime(a.occurredAt)}</span>
                      {a.user && <span>· {a.user.name}</span>}
                      {a.contact && <span>· với {a.contact.name}</span>}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{a.content}</p>
                  </li>
                ))}
              </ol>
              {!showAll && data.timeline.filter((a) => !careOnly || a.type !== 'ORDER').length > 15 && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
                  Xem thêm
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sức khỏe khách hàng</CardTitle>
              {h && <Badge tone={h.tone}>{h.label}</Badge>}
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">
                {c.healthScore ?? '—'}
                <span className="text-base font-normal text-muted-foreground">/100</span>
              </div>
              {c.healthReasons && (
                <>
                  <div className="mt-3 space-y-1.5">
                    {Object.entries(BREAKDOWN_LABEL).map(([k, [label, max]]) => {
                      const v = c.healthReasons!.breakdown[k] ?? 0;
                      return (
                        <div key={k}>
                          <div className="flex justify-between text-xs">
                            <span>{label}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {v}/{max}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 rounded bg-muted">
                            <div className="h-1.5 rounded bg-primary/80" style={{ width: `${(100 * v) / max}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {c.healthReasons.reasons.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs">
                      {c.healthReasons.reasons.map((r) => (
                        <li key={r} className="flex gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">Cập nhật {dateTime(c.healthUpdatedAt)} · điểm theo quy tắc, chưa phải mô hình dự đoán.</p>
              {c.overdueDebtDays ? <p className="mt-2 text-xs text-rose-700">Công nợ quá hạn {c.overdueDebtDays} ngày (từ MISA)</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Người liên hệ</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setContactOpen(true)}>
                <UserPlus className="h-4 w-4" />
              </Button>
            </CardHeader>
            <ul className="divide-y">
              {c.contacts.length === 0 && <Empty>Chưa có người liên hệ.</Empty>}
              {c.contacts.map((p) => (
                <li key={p.id} className={`px-4 py-2.5 text-sm ${p.leftCompanyAt ? 'opacity-50' : ''}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{p.name}</span>
                    <Badge>{CONTACT_ROLE[p.role]}</Badge>
                    {p.isDecisionMaker && <Badge tone="violet">Ra quyết định</Badge>}
                    {p.leftCompanyAt && <Badge tone="amber">Đã nghỉ việc</Badge>}
                  </div>
                  {p.title && <div className="text-xs text-muted-foreground">{p.title}</div>}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-primary">
                        <Phone className="h-3 w-3" />
                        {p.phone}
                      </a>
                    )}
                    {p.email && (
                      <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-primary">
                        <Mail className="h-3 w-3" />
                        {p.email}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ticket</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setTicketOpen(true)}>
                Tạo ticket
              </Button>
            </CardHeader>
            <ul className="divide-y">
              {data.tickets.length === 0 && <Empty>Chưa có ticket.</Empty>}
              {data.tickets.map((t) => (
                <li key={t.id} className="px-4 py-2.5 text-sm">
                  <Link href={`/tickets/${t.number}`} className="font-medium hover:underline">
                    #{t.number} {t.subject}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
                    <Badge>{TICKET_CATEGORY[t.category]}</Badge>
                    {t.slaBreached && <Badge tone="rose">Quá SLA</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Đơn hàng gần đây</CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {data.orders.length === 0 && <Empty>Chưa có đơn hàng.</Empty>}
              {data.orders.slice(0, 8).map((o) => (
                <li key={o.id} className="px-4 py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{o.code}</span>
                    <span className="tabular-nums">{vnd(o.totalAmount)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {date(o.orderDate)} · {o.items.map((i) => `${i.productName} ×${Number(i.quantity).toLocaleString('vi-VN')}`).join(', ')}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} onDone={() => mutate()} />
      <ContactDialog open={contactOpen} onClose={() => setContactOpen(false)} customerId={id} onSaved={() => mutate()} />
      <TicketDialog open={ticketOpen} onClose={() => setTicketOpen(false)} customerId={id} contacts={c.contacts} onSaved={() => mutate()} />
    </>
  );
}

function ContactDialog({ open, onClose, customerId, onSaved }: { open: boolean; onClose: () => void; customerId: string; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', title: '', role: 'PURCHASING', phone: '', email: '', isDecisionMaker: false });
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/customers/${customerId}/contacts`, 'POST', { ...form, email: form.email || undefined, phone: form.phone || undefined, title: form.title || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Thêm người liên hệ">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Họ tên *</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <Label>Chức vụ</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <Label>Vai trò mua hàng</Label>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(CONTACT_ROLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Điện thoại</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isDecisionMaker} onChange={(e) => setForm({ ...form, isDecisionMaker: e.target.checked })} />
          Người ra quyết định
        </label>
        {error && <p className="col-span-2 text-sm text-rose-600">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit">Lưu</Button>
        </div>
      </form>
    </Dialog>
  );
}

function TicketDialog({
  open, onClose, customerId, contacts, onSaved,
}: { open: boolean; onClose: () => void; customerId: string; contacts: { id: string; name: string }[]; onSaved: () => void }) {
  const [form, setForm] = useState({ subject: '', description: '', category: 'QUALITY', priority: 'NORMAL', contactId: '' });
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/tickets', 'POST', { ...form, customerId, contactId: form.contactId || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Tạo ticket / ghi nhận khiếu nại">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Tiêu đề *</Label>
          <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required minLength={3} />
        </div>
        <div>
          <Label>Phân loại</Label>
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(TICKET_CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Mức ưu tiên (SLA)</Label>
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="URGENT">Khẩn – phản hồi 4 giờ</option>
            <option value="HIGH">Cao – 8 giờ</option>
            <option value="NORMAL">Bình thường – 24 giờ</option>
            <option value="LOW">Thấp – 72 giờ</option>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Người báo</Label>
          <Select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
            <option value="">—</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Mô tả (lô hàng, số lượng lỗi, hình ảnh…)</Label>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        {error && <p className="col-span-2 text-sm text-rose-600">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit">Tạo ticket</Button>
        </div>
      </form>
    </Dialog>
  );
}
