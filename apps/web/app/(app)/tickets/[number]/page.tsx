'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PRIORITY, TICKET_CATEGORY, TICKET_STATUS } from '@/lib/labels';
import { useUsers } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';
import { ErrorBox, Loading } from '@/components/ui/misc';

interface TicketDetail {
  id: string;
  number: number;
  subject: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  slaDueAt: string;
  slaBreached: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  customer: { id: string; name: string; code: string };
  contact: { name: string; phone: string | null } | null;
  assignee: { id: string; name: string } | null;
  comments: { id: string; body: string; isInternal: boolean; createdAt: string; author: { name: string } | null }[];
}

export default function TicketPage() {
  const { number } = useParams<{ number: string }>();
  const { data, error, isLoading, mutate } = useSWR<TicketDetail>(`/tickets/${number}`, fetcher);
  const users = useUsers();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState('');

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Loading />;

  async function update(patch: Record<string, string>) {
    try {
      await api(`/tickets/${number}`, 'PATCH', patch);
      mutate();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function comment(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/tickets/${number}/comments`, 'POST', { body, isInternal: internal });
      setBody('');
      mutate();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div>
          <div className="text-sm text-muted-foreground">Ticket #{data.number}</div>
          <h1 className="text-xl font-semibold">{data.subject}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={TICKET_STATUS[data.status].tone}>{TICKET_STATUS[data.status].label}</Badge>
            <Badge>{TICKET_CATEGORY[data.category]}</Badge>
            <Badge tone={PRIORITY[data.priority].tone}>{PRIORITY[data.priority].label}</Badge>
            {data.slaBreached && <Badge tone="rose">Quá SLA</Badge>}
          </div>
        </div>
        {data.description && (
          <Card>
            <CardContent className="whitespace-pre-wrap text-sm">{data.description}</CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Trao đổi xử lý</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.comments.map((c) => (
              <div key={c.id} className={`rounded-md p-3 text-sm ${c.isInternal ? 'bg-amber-50' : 'bg-muted/60'}`}>
                <div className="mb-1 text-xs text-muted-foreground">
                  {c.author?.name ?? 'Hệ thống'} · {dateTime(c.createdAt)} {c.isInternal && '· Ghi chú nội bộ'}
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
            <form onSubmit={comment} className="space-y-2">
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Phản hồi khách / cập nhật tiến độ (containment, 8D, đổi hàng…)" />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Ghi chú nội bộ (không tính là phản hồi khách)
                </label>
                <Button size="sm" type="submit">
                  Gửi
                </Button>
              </div>
            </form>
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </CardContent>
        </Card>
      </div>
      <Card className="h-fit">
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label>Khách hàng</Label>
            <Link href={`/customers/${data.customer.id}`} className="font-medium hover:underline">
              {data.customer.name}
            </Link>
            {data.contact && (
              <div className="text-xs text-muted-foreground">
                Người báo: {data.contact.name} {data.contact.phone}
              </div>
            )}
          </div>
          <div>
            <Label>Trạng thái</Label>
            <Select value={data.status} onChange={(e) => update({ status: e.target.value })}>
              {Object.entries(TICKET_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Ưu tiên</Label>
            <Select value={data.priority} onChange={(e) => update({ priority: e.target.value })}>
              {Object.entries(PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Người xử lý</Label>
            <Select value={data.assignee?.id ?? ''} onChange={(e) => e.target.value && update({ assigneeId: e.target.value })}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <dl className="grid grid-cols-2 gap-1 text-xs">
            <dt className="text-muted-foreground">Tạo lúc</dt>
            <dd>{dateTime(data.createdAt)}</dd>
            <dt className="text-muted-foreground">Hạn phản hồi</dt>
            <dd className={data.slaBreached ? 'text-rose-700' : ''}>{dateTime(data.slaDueAt)}</dd>
            <dt className="text-muted-foreground">Phản hồi đầu</dt>
            <dd>{dateTime(data.firstResponseAt)}</dd>
            <dt className="text-muted-foreground">Giải quyết</dt>
            <dd>{dateTime(data.resolvedAt)}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
