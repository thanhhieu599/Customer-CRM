'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, Paged } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PRIORITY, TICKET_CATEGORY, TICKET_STATUS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/ui/misc';

interface TicketRow {
  id: string;
  number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  slaDueAt: string;
  slaBreached: boolean;
  firstResponseAt: string | null;
  createdAt: string;
  customer: { id: string; name: string };
  assignee: { name: string } | null;
}

export default function TicketsPage() {
  const [view, setView] = useState('open');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ pageSize: '100', ...(view && { view }), ...(q && { q }) });
  const { data, error, isLoading } = useSWR<Paged<TicketRow>>(`/tickets?${qs}`, fetcher);

  return (
    <>
      <PageHeader title="Ticket / Khiếu nại" subtitle="Tạo ticket từ trang khách hàng. SLA tính theo mức ưu tiên: Khẩn 4h · Cao 8h · Bình thường 24h · Thấp 72h." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex rounded-md border bg-card p-0.5">
          {[
            ['open', 'Đang mở'],
            ['breached', 'Quá SLA'],
            ['mine', 'Của tôi'],
            ['', 'Tất cả'],
          ].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={cn('rounded px-3 py-1.5 text-sm', view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
              {label}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tiêu đề…" className="max-w-xs" />
      </div>
      {error && <ErrorBox error={error} />}
      <Card>
        {isLoading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>Không có ticket.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Tiêu đề</Th>
                <Th>Khách hàng</Th>
                <Th>Trạng thái</Th>
                <Th>Ưu tiên</Th>
                <Th>Hạn phản hồi</Th>
                <Th>Xử lý</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <Tr key={t.id}>
                  <Td className="tabular-nums text-muted-foreground">{t.number}</Td>
                  <Td>
                    <Link href={`/tickets/${t.number}`} className="font-medium hover:underline">
                      {t.subject}
                    </Link>
                    <div className="text-xs text-muted-foreground">{TICKET_CATEGORY[t.category]}</div>
                  </Td>
                  <Td>
                    <Link href={`/customers/${t.customer.id}`} className="hover:underline">
                      {t.customer.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                  </Td>
                  <Td className={t.slaBreached ? 'font-medium text-rose-700' : ''}>
                    {t.firstResponseAt ? <span className="text-emerald-700">Đã phản hồi</span> : dateTime(t.slaDueAt)}
                    {t.slaBreached && <div className="text-xs">Quá SLA</div>}
                  </Td>
                  <Td className="text-xs">{t.assignee?.name ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
