'use client';
import { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { ROLE } from '@/lib/labels';
import { useMe } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/misc';

interface Rule {
  id: string;
  key: string;
  name: string;
  trigger: string;
  isActive: boolean;
  config: Record<string, unknown>;
  _count: { executions: number };
}

const CONFIG_LABEL: Record<string, string> = {
  cycleMultiplier: 'Hệ số chu kỳ',
  fallbackCycleDays: 'Chu kỳ mặc định (ngày)',
  minDays: 'Tối thiểu (ngày)',
  maxDays: 'Tối đa (ngày)',
  dueInDays: 'Hạn xử lý (ngày)',
  maxTasksPerRun: 'Tối đa việc / lần chạy',
  dueSoonDays: 'Nhắc trước (ngày)',
  minConfidence: 'Độ tin cậy tối thiểu',
  daysAfterDelivery: 'Sau giao (ngày)',
  lookbackDays: 'Quét lùi (ngày)',
  minOrderAmount: 'Giá trị đơn tối thiểu (đ)',
  days: 'Không tương tác (ngày)',
  notifyManagers: 'Báo quản lý',
};

export default function SettingsPage() {
  const { isAdmin } = useMe();
  const { data: rules, mutate } = useSWR<Rule[]>('/retention/rules', fetcher);
  const { data: users, mutate: mutateUsers } = useSWR<{ id: string; name: string; email: string; role: string; isActive: boolean }[]>('/users', fetcher);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'AGENT' });
  const [msg, setMsg] = useState('');

  async function toggle(r: Rule) {
    await api(`/retention/rules/${r.key}`, 'PATCH', { isActive: !r.isActive });
    mutate();
  }

  async function saveConfig(r: Rule, key: string, raw: string) {
    const old = r.config[key];
    const value = typeof old === 'number' ? Number(raw) : typeof old === 'boolean' ? raw === 'true' : raw;
    await api(`/retention/rules/${r.key}`, 'PATCH', { config: { [key]: value } });
    mutate();
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/users', 'POST', form);
      setForm({ name: '', email: '', password: '', role: 'AGENT' });
      setMsg('Đã tạo tài khoản');
      mutateUsers();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function setActive(id: string, isActive: boolean) {
    await api(`/users/${id}`, 'PATCH', { isActive });
    mutateUsers();
  }

  return (
    <>
      <PageHeader title="Cấu hình" subtitle="Quy tắc chăm sóc tự động và tài khoản nhân viên." />
      <Card>
        <CardHeader>
          <CardTitle>Quy tắc chăm sóc tự động (Retention Engine)</CardTitle>
          <span className="text-xs text-muted-foreground">Chạy 01:00 hằng ngày · SLA mỗi 15 phút</span>
        </CardHeader>
        <ul className="divide-y">
          {rules?.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.key} · đã chạy {r._count.executions} lần
                  </div>
                </div>
                {isAdmin ? (
                  <Button size="sm" variant={r.isActive ? 'outline' : 'default'} onClick={() => toggle(r)}>
                    {r.isActive ? 'Tắt' : 'Bật'}
                  </Button>
                ) : (
                  <Badge tone={r.isActive ? 'emerald' : 'slate'}>{r.isActive ? 'Đang bật' : 'Tắt'}</Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                {Object.entries(r.config).map(([k, v]) => (
                  <label key={k} className="text-xs">
                    <span className="mb-0.5 block text-muted-foreground">{CONFIG_LABEL[k] ?? k}</span>
                    <Input
                      defaultValue={String(v)}
                      disabled={!isAdmin}
                      className="h-8 w-32"
                      onBlur={(e) => e.target.value !== String(v) && saveConfig(r, k, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Tài khoản nhân viên</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Họ tên</Th>
              <Th>Email</Th>
              <Th>Vai trò</Th>
              <Th>Trạng thái</Th>
              {isAdmin && <Th />}
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <Tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{ROLE[u.role]}</Td>
                <Td>
                  <Badge tone={u.isActive ? 'emerald' : 'slate'}>{u.isActive ? 'Hoạt động' : 'Khóa'}</Badge>
                </Td>
                {isAdmin && (
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setActive(u.id, !u.isActive)}>
                      {u.isActive ? 'Khóa' : 'Mở khóa'}
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
        {isAdmin && (
          <CardContent className="border-t">
            <form onSubmit={createUser} className="flex flex-wrap items-end gap-2">
              <div>
                <Label>Họ tên</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div>
                <Label>Mật khẩu (≥ 8 ký tự)</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
              </div>
              <div>
                <Label>Vai trò</Label>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-40">
                  {Object.entries(ROLE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit">Tạo tài khoản</Button>
              {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
            </form>
          </CardContent>
        )}
      </Card>
    </>
  );
}
