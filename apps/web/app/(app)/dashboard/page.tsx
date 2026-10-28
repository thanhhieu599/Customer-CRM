'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, Clock, HeartPulse, RefreshCw, Users } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useMe } from '@/lib/session';
import { money, pct } from '@/lib/format';
import { HEALTH, PRIORITY, SEGMENT, TASK_TYPE } from '@/lib/labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/ui/misc';

interface Dashboard {
  scope: 'team' | 'me';
  kpis: {
    customersNeedingCare: number;
    openTasks: number;
    overdueTasks: number;
    taskCompletionRate: number | null;
    overdueFollowUpRate: number | null;
    firstResponseHours: number | null;
    ticketSlaCompliance: number | null;
    ticketsInPeriod: number;
    repeatPurchaseRate: number | null;
    repeatPurchaseRevenue: number;
    reactivationRate: number | null;
    careConversionRate: number | null;
    careTasksInPeriod: number;
  };
  segments: Record<string, number>;
  health: Record<string, number>;
  repeatPurchaseTrend: { month: string; repeatPurchaseRate: number | null; eligible: number }[];
  todayTasks: {
    id: string;
    title: string;
    type: string;
    priority: string;
    dueAt: string;
    customer: { id: string; name: string; segment: string; healthScore: number | null } | null;
  }[];
  agents: {
    user: { id: string; name: string };
    openTasks: number;
    overdueTasks: number;
    doneInPeriod: number;
    customers: number;
    atRiskCustomers: number;
    keyCustomersNoContact30d: number;
  }[];
}

function Kpi({ label, value, hint, icon: Icon, alert }: { label: string; value: string | number; hint?: string; icon: typeof Users; alert?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {label}
          <Icon className={alert ? 'h-4 w-4 text-rose-600' : 'h-4 w-4'} />
        </div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${alert ? 'text-rose-700' : ''}`}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState(30);
  const { isManager } = useMe();
  const { data, error, isLoading, mutate } = useSWR<Dashboard>(`/dashboard?period=${period}`, fetcher);
  const [running, setRunning] = useState(false);

  async function runEngine() {
    setRunning(true);
    try {
      await api('/retention/run', 'POST');
      await mutate();
    } finally {
      setRunning(false);
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Loading />;
  const k = data.kpis;
  const segTotal = Object.values(data.segments).reduce((a, b) => a + b, 0) || 1;
  const trend = data.repeatPurchaseTrend.map((t) => ({ ...t, label: `T${Number(t.month.slice(5))}` }));

  return (
    <>
      <PageHeader
        title={data.scope === 'team' ? 'Tổng quan chăm sóc khách hàng' : 'Tổng quan của tôi'}
        subtitle="Ai cần chăm sóc hôm nay, việc nào đang trễ, khách nào có nguy cơ rời bỏ."
        actions={
          <>
            <Select value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="w-36" aria-label="Kỳ báo cáo">
              <option value={7}>7 ngày</option>
              <option value={30}>30 ngày</option>
              <option value={90}>90 ngày</option>
            </Select>
            {isManager && (
              <Button variant="outline" onClick={runEngine} disabled={running}>
                <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} /> Chạy phân tích ngay
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Khách cần chăm sóc hôm nay" value={k.customersNeedingCare} icon={Users} hint={`${k.openTasks} việc đang mở`} />
        <Kpi label="Nhiệm vụ quá hạn" value={k.overdueTasks} icon={AlertTriangle} alert={k.overdueTasks > 0} hint={`Tỷ lệ quá hạn ${pct(k.overdueFollowUpRate)}`} />
        <Kpi label="Tỷ lệ mua lại" value={pct(k.repeatPurchaseRate)} icon={HeartPulse} hint={`Doanh thu mua lại ${money(k.repeatPurchaseRevenue)}`} />
        <Kpi label="Ticket đúng SLA" value={pct(k.ticketSlaCompliance)} icon={Clock} hint={`${k.ticketsInPeriod} ticket · phản hồi TB ${k.firstResponseHours ?? '—'} giờ`} />
        <Kpi label="Hoàn thành nhiệm vụ" value={pct(k.taskCompletionRate)} icon={CheckCircle2} hint={`Việc đến hạn trong ${period} ngày`} />
        <Kpi label="Chăm sóc → có đơn (14 ngày)" value={pct(k.careConversionRate)} icon={CheckCircle2} hint={`${k.careTasksInPeriod} việc giữ chân / nhắc đặt lại`} />
        <Kpi label="Khách ngủ đông quay lại" value={pct(k.reactivationRate)} icon={RefreshCw} hint="Đơn mới sau > 180 ngày" />
        <Kpi
          label="Khách nguy cơ + ngủ đông"
          value={(data.segments.AT_RISK ?? 0) + (data.segments.DORMANT ?? 0)}
          icon={AlertTriangle}
          alert={(data.segments.AT_RISK ?? 0) > 0}
          hint="Cần kế hoạch giữ chân"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Việc của tôi hôm nay & quá hạn</CardTitle>
            <Link href="/tasks" className="text-xs text-primary hover:underline">
              Xem tất cả
            </Link>
          </CardHeader>
          {data.todayTasks.length === 0 ? (
            <Empty>Không có việc đến hạn. Tuyệt vời!</Empty>
          ) : (
            <ul className="divide-y">
              {data.todayTasks.map((t) => {
                const overdue = new Date(t.dueAt) < new Date();
                return (
                  <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge tone="slate">{TASK_TYPE[t.type]}</Badge>
                        {t.customer && (
                          <Link href={`/customers/${t.customer.id}`} className="hover:underline">
                            {t.customer.name}
                          </Link>
                        )}
                        {overdue && <span className="font-medium text-rose-600">Quá hạn</span>}
                      </div>
                    </div>
                    <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phân khúc khách hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {Object.entries(SEGMENT).map(([key, s]) => {
              const n = data.segments[key] ?? 0;
              return (
                <Link key={key} href={`/customers?segment=${key}`} className="block group" title={`${s.label}: ${n} khách`}>
                  <div className="flex justify-between text-xs">
                    <span className="group-hover:underline">{s.label}</span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-muted">
                    <div className="h-2 rounded bg-primary/80" style={{ width: `${(100 * n) / segTotal}%` }} />
                  </div>
                </Link>
              );
            })}
            <div className="flex flex-wrap gap-1.5 pt-2">
              {Object.entries(HEALTH).map(([key, h]) => (
                <Link key={key} href={`/customers?healthLevel=${key}`}>
                  <Badge tone={h.tone}>
                    {h.label}: {data.health[key] ?? 0}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tỷ lệ mua lại theo tháng</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48" role="img" aria-label={`Tỷ lệ mua lại: ${trend.map((t) => `${t.label} ${t.repeatPurchaseRate ?? '—'}%`).join(', ')}`}>
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} unit="%" stroke="var(--muted-foreground)" />
                  <Tooltip
                    formatter={(v) => [`${v ?? '—'}%`, 'Tỷ lệ mua lại']}
                    labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.eligible ?? 0} khách đủ điều kiện`}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <Line type="monotone" dataKey="repeatPurchaseRate" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Khách đã mua trong 12 tháng trước tháng đó và có đơn trong tháng. Tháng hiện tại chưa trọn tháng.
            </p>
          </CardContent>
        </Card>

        {data.scope === 'team' && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Hiệu suất nhân viên – ai đang bỏ sót khách?</CardTitle>
            </CardHeader>
            <Table>
              <thead>
                <tr>
                  <Th>Nhân viên</Th>
                  <Th className="text-right">KH phụ trách</Th>
                  <Th className="text-right">Việc mở</Th>
                  <Th className="text-right">Quá hạn</Th>
                  <Th className="text-right">Hoàn thành ({period}n)</Th>
                  <Th className="text-right">KH nguy cơ</Th>
                  <Th className="text-right">KH chủ chốt chưa chăm 30n</Th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <Tr key={a.user.id}>
                    <Td className="font-medium">
                      <Link href={`/customers?ownerId=${a.user.id}`} className="hover:underline">
                        {a.user.name}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums">{a.customers}</Td>
                    <Td className="text-right tabular-nums">{a.openTasks}</Td>
                    <Td className={`text-right tabular-nums ${a.overdueTasks ? 'font-semibold text-rose-700' : ''}`}>{a.overdueTasks}</Td>
                    <Td className="text-right tabular-nums">{a.doneInPeriod}</Td>
                    <Td className="text-right tabular-nums">{a.atRiskCustomers}</Td>
                    <Td className={`text-right tabular-nums ${a.keyCustomersNoContact30d ? 'font-semibold text-amber-700' : ''}`}>{a.keyCustomersNoContact30d}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
