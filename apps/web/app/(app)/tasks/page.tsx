'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher, Paged } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PRIORITY, SEGMENT, TASK_STATUS, TASK_TYPE } from '@/lib/labels';
import { useMe, useUsers } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Empty, ErrorBox, HealthPill, Loading, PageHeader } from '@/components/ui/misc';
import { CompleteTaskDialog } from '@/components/complete-task';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  source: string;
  dueAt: string;
  result: string | null;
  customer: { id: string; name: string; code: string; segment: string; healthScore: number | null } | null;
  assignee: { id: string; name: string } | null;
  ticket: { number: number; subject: string } | null;
}

const VIEWS = [
  ['today', 'Hôm nay'],
  ['overdue', 'Quá hạn'],
  ['week', '7 ngày tới'],
  ['open', 'Tất cả việc mở'],
  ['', 'Lịch sử'],
] as const;

function TasksInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { isManager } = useMe();
  const users = useUsers();
  const view = params.get('view') ?? 'today';
  const assignee = params.get('assignee') ?? (isManager ? 'all' : 'mine');
  const type = params.get('type') ?? '';
  const qs = new URLSearchParams({ pageSize: '100', assignee, ...(view && { view }), ...(type && { type }) });
  const { data, error, isLoading, mutate } = useSWR<Paged<TaskRow>>(`/tasks?${qs}`, fetcher);
  const [completing, setCompleting] = useState<TaskRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    router.replace(`/tasks?${next}`);
  };

  return (
    <>
      <PageHeader title="Việc cần làm" subtitle="Hệ thống tự tạo việc khi khách quá chu kỳ mua, sắp đến hạn đặt lại, có nguy cơ rời bỏ hoặc ticket quá SLA." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border bg-card p-0.5">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              onClick={() => set('view', v)}
              className={cn('rounded px-3 py-1.5 text-sm', view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {label}
            </button>
          ))}
        </div>
        <Select value={type} onChange={(e) => set('type', e.target.value)} className="w-44" aria-label="Loại việc">
          <option value="">Mọi loại việc</option>
          {Object.entries(TASK_TYPE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        {isManager && (
          <Select value={assignee} onChange={(e) => set('assignee', e.target.value)} className="w-48" aria-label="Người làm">
            <option value="all">Cả nhóm</option>
            <option value="mine">Việc của tôi</option>
            <option value="unassigned">Chưa giao</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {error && <ErrorBox error={error} />}
      <Card>
        {isLoading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>Không có việc nào trong mục này.</Empty>
        ) : (
          <ul className="divide-y">
            {data.items.map((t) => {
              const open = t.status === 'OPEN' || t.status === 'IN_PROGRESS';
              const overdue = open && new Date(t.dueAt) < new Date();
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <button className="min-w-0 text-left" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge>{TASK_TYPE[t.type]}</Badge>
                        <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                        {t.source === 'AUTOMATION' && <Badge tone="blue">Tự động</Badge>}
                        <span className={overdue ? 'font-medium text-rose-600' : ''}>
                          {overdue ? 'Quá hạn · ' : 'Hạn '}
                          {dateTime(t.dueAt)}
                        </span>
                        <span>· {t.assignee?.name ?? 'Chưa giao'}</span>
                        {!open && <span>· {TASK_STATUS[t.status]}</span>}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {t.customer && (
                        <Link href={`/customers/${t.customer.id}`} className="hidden text-right text-xs sm:block">
                          <div className="font-medium hover:underline">{t.customer.name}</div>
                          <div className="mt-0.5 flex justify-end gap-1">
                            <Badge tone={SEGMENT[t.customer.segment].tone}>{SEGMENT[t.customer.segment].label}</Badge>
                            <HealthPill score={t.customer.healthScore} level={null} />
                          </div>
                        </Link>
                      )}
                      {open && (
                        <Button size="sm" onClick={() => setCompleting(t)}>
                          Hoàn thành
                        </Button>
                      )}
                    </div>
                  </div>
                  {expanded === t.id && (
                    <div className="mt-2 rounded-md bg-muted/60 p-3 text-xs">
                      {t.description && <pre className="whitespace-pre-wrap font-sans">{t.description}</pre>}
                      {t.result && <p className="mt-2 font-medium">Kết quả: {t.result}</p>}
                      {t.ticket && (
                        <Link href={`/tickets/${t.ticket.number}`} className="mt-2 inline-block text-primary hover:underline">
                          Mở ticket #{t.ticket.number}
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} onDone={() => mutate()} />
    </>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TasksInner />
    </Suspense>
  );
}
