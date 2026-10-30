'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/ui/misc';
import { CompleteTaskDialog } from '@/components/complete-task';
interface Task {
  id: string;
  title: string;
  dueAt: string;
  customer: { id: string; name: string } | null;
  quote: { opportunityId: string } | null;
}
interface Day {
  tasks: Task[];
  quotes: {
    id: string;
    version: number;
    followUpAt: string;
    opportunity: { id: string; title: string; customer: { name: string } };
  }[];
  opportunities: { id: string; title: string; nextActionAt: string; customer: { name: string } }[];
  tickets: { id: string; number: number; subject: string; slaDueAt: string; customer: { name: string } }[];
  limitPerSection: number;
}
export default function Page() {
  const { data, error, mutate } = useSWR<Day>('/workbench', fetcher, { refreshInterval: 60000 });
  const [task, setTask] = useState<Task | null>(null);
  if (error) return <ErrorBox error={error} />;
  const deadline = (value: string) => (
    <span className={new Date(value) < new Date() ? 'text-rose-700' : 'text-muted-foreground'}>
      {new Date(value) < new Date() ? 'Quá hạn · ' : 'Hạn '}
      {dateTime(value)}
    </span>
  );
  return (
    <>
      <PageHeader
        title="Ngày làm việc của tôi"
        subtitle="Việc đến hạn hôm nay và quá hạn, báo giá cần theo dõi, cơ hội cần xử lý và ticket sắp trễ. Tự cập nhật mỗi phút."
      />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Việc cần làm', data.tasks.length],
              ['Báo giá chờ phản hồi', data.quotes.length],
              ['Cơ hội đến lịch', data.opportunities.length],
              ['Ticket đến hạn', data.tickets.length],
            ].map(([title, count]) => (
              <Card className="p-4" key={title}>
                <div className="text-xs text-muted-foreground">{title}</div>
                <div className="mt-2 text-2xl font-semibold">
                  {count}
                  {count === data.limitPerSection ? '+' : ''}
                </div>
              </Card>
            ))}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="border-b p-4 font-semibold">Nhiệm vụ & nhắc mua lại</h2>
              {!data.tasks.length && <Empty>Không có việc đến hạn.</Empty>}
              {data.tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 border-b p-4">
                  <div>
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="mt-1 text-xs">
                      {t.customer && (
                        <Link className="mr-2 text-primary" href={`/customers/${t.customer.id}`}>
                          {t.customer.name}
                        </Link>
                      )}
                      {deadline(t.dueAt)}
                    </div>
                    {t.quote && (
                      <Link href={`/opportunities/${t.quote.opportunityId}`} className="text-xs text-primary">
                        Mở báo giá liên quan
                      </Link>
                    )}
                  </div>
                  <Button size="sm" onClick={() => setTask(t)}>
                    Ghi kết quả
                  </Button>
                </div>
              ))}
              <Link href="/tasks" className="block p-3 text-sm text-primary">
                Xem tất cả công việc →
              </Link>
            </Card>
            <Card>
              <h2 className="border-b p-4 font-semibold">
                Báo giá cần theo dõi <Badge>Đã gửi</Badge>
              </h2>
              {!data.quotes.length && <Empty>Không có báo giá cần theo dõi.</Empty>}
              {data.quotes.map((q) => (
                <Link
                  key={q.id}
                  href={`/opportunities/${q.opportunity.id}`}
                  className="block border-b p-4 hover:bg-muted"
                >
                  <div className="text-sm font-medium">
                    {q.opportunity.title} · v{q.version}
                  </div>
                  <div className="mt-1 text-xs">
                    {q.opportunity.customer.name} · {deadline(q.followUpAt)}
                  </div>
                </Link>
              ))}
            </Card>
            <Card>
              <h2 className="border-b p-4 font-semibold">Cơ hội cần bước tiếp theo</h2>
              {!data.opportunities.length && <Empty>Chưa có cơ hội đến lịch.</Empty>}
              {data.opportunities.map((o) => (
                <Link key={o.id} href={`/opportunities/${o.id}`} className="block border-b p-4 hover:bg-muted">
                  <div className="text-sm font-medium">{o.title}</div>
                  <div className="mt-1 text-xs">
                    {o.customer.name} · {deadline(o.nextActionAt)}
                  </div>
                </Link>
              ))}
            </Card>
            <Card>
              <h2 className="border-b p-4 font-semibold">Ticket cần xử lý</h2>
              {!data.tickets.length && <Empty>Không có ticket đến hạn.</Empty>}
              {data.tickets.map((t) => (
                <Link key={t.id} href={`/tickets/${t.number}`} className="block border-b p-4 hover:bg-muted">
                  <div className="text-sm font-medium">
                    #{t.number} · {t.subject}
                  </div>
                  <div className="mt-1 text-xs">
                    {t.customer.name} · {deadline(t.slaDueAt)}
                  </div>
                </Link>
              ))}
            </Card>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Mỗi nhóm hiển thị tối đa {data.limitPerSection} mục đến hạn sớm nhất. Báo giá và nhiệm vụ liên quan có thể
            xuất hiện ở cả hai nhóm.
          </p>
        </>
      )}
      <CompleteTaskDialog task={task} onClose={() => setTask(null)} onDone={() => mutate()} />
    </>
  );
}
