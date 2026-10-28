'use client';
import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { api, fetcher, Paged } from '@/lib/api';
import { daysAgo, money } from '@/lib/format';
import { HEALTH, SEGMENT } from '@/lib/labels';
import { useUsers } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Empty, ErrorBox, HealthPill, Loading, PageHeader } from '@/components/ui/misc';

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  tier: string | null;
  segment: string;
  healthScore: number | null;
  healthLevel: string | null;
  lastOrderAt: string | null;
  orderCycleDays: number | null;
  revenue12m: string;
  owner: { id: string; name: string } | null;
  tags: { tag: { name: string } }[];
  _count: { tickets: number };
}

function CustomersInner() {
  const router = useRouter();
  const params = useSearchParams();
  const users = useUsers();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [creating, setCreating] = useState(false);
  const filters = {
    q: params.get('q') ?? '',
    segment: params.get('segment') ?? '',
    healthLevel: params.get('healthLevel') ?? '',
    ownerId: params.get('ownerId') ?? '',
    sort: params.get('sort') ?? 'healthScore',
    order: params.get('order') ?? 'asc',
    page: Number(params.get('page') ?? 1),
  };
  const qs = new URLSearchParams(Object.entries({ ...filters, page: String(filters.page), pageSize: '25' }).filter(([, v]) => v !== '') as [string, string][]);
  const { data, error, isLoading } = useSWR<Paged<CustomerRow>>(`/customers?${qs}`, fetcher, { keepPreviousData: true });

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: '1', ...patch }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    router.replace(`/customers?${next}`);
  };

  useEffect(() => {
    const t = setTimeout(() => q !== filters.q && set({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={data ? `${data.total} khách hàng` : undefined}
        actions={<Button onClick={() => setCreating(true)}>Thêm khách hàng</Button>}
      />
      <NewCustomer open={creating} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/customers/${id}`)} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, mã KH, MST, SĐT, người liên hệ…" className="max-w-xs" />
        <Select value={filters.segment} onChange={(e) => set({ segment: e.target.value })} className="w-44" aria-label="Phân khúc">
          <option value="">Mọi phân khúc</option>
          {Object.entries(SEGMENT).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select value={filters.healthLevel} onChange={(e) => set({ healthLevel: e.target.value })} className="w-40" aria-label="Sức khỏe">
          <option value="">Mọi mức sức khỏe</option>
          {Object.entries(HEALTH).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        {users.length > 0 && (
          <Select value={filters.ownerId} onChange={(e) => set({ ownerId: e.target.value })} className="w-44" aria-label="Người phụ trách">
            <option value="">Mọi người phụ trách</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
        <Select value={`${filters.sort}:${filters.order}`} onChange={(e) => { const [sort, order] = e.target.value.split(':'); set({ sort, order }); }} className="w-52" aria-label="Sắp xếp">
          <option value="healthScore:asc">Sức khỏe thấp nhất trước</option>
          <option value="lastOrderAt:asc">Lâu chưa mua nhất trước</option>
          <option value="revenue12m:desc">Doanh thu 12 tháng cao nhất</option>
          <option value="name:asc">Tên A → Z</option>
          <option value="createdAt:desc">Mới tạo</option>
        </Select>
      </div>

      {error && <ErrorBox error={error} />}
      <Card>
        {isLoading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>Không có khách hàng phù hợp.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Khách hàng</Th>
                <Th>Phân khúc</Th>
                <Th>Sức khỏe</Th>
                <Th>Lần mua gần nhất</Th>
                <Th className="text-right">Doanh thu 12 tháng</Th>
                <Th>Ticket mở</Th>
                <Th>Phụ trách</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => {
                const ago = daysAgo(c.lastOrderAt);
                const late = ago !== null && c.orderCycleDays && ago > c.orderCycleDays * 1.3;
                return (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {c.code}
                        {c.tier && ` · Hạng ${c.tier}`}
                        {c.tags.map((t) => ` · #${t.tag.name}`)}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={SEGMENT[c.segment].tone}>{SEGMENT[c.segment].label}</Badge>
                    </Td>
                    <Td>
                      <HealthPill score={c.healthScore} level={c.healthLevel} />
                    </Td>
                    <Td className={late ? 'text-rose-700' : ''}>
                      {ago === null ? '—' : `${ago} ngày trước`}
                      {c.orderCycleDays && <div className="text-xs text-muted-foreground">chu kỳ ≈{c.orderCycleDays} ngày</div>}
                    </Td>
                    <Td className="text-right tabular-nums">{money(c.revenue12m)}</Td>
                    <Td>{c._count.tickets ? <Badge tone="rose">{c._count.tickets}</Badge> : '—'}</Td>
                    <Td className="text-xs">{c.owner?.name ?? <span className="text-amber-700">Chưa giao</span>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {data && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => set({ page: String(filters.page - 1) })}>
            Trước
          </Button>
          <span>
            Trang {filters.page}/{Math.ceil(data.total / data.pageSize)}
          </span>
          <Button variant="outline" size="sm" disabled={filters.page * data.pageSize >= data.total} onClick={() => set({ page: String(filters.page + 1) })}>
            Sau
          </Button>
        </div>
      )}
    </>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CustomersInner />
    </Suspense>
  );
}

function NewCustomer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ code: '', name: '', taxCode: '', industry: '', phone: '', address: '' });
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      const c = await api<{ id: string }>('/customers', 'POST', body);
      onCreated(c.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const field = (k: keyof typeof form, label: string, required = false) => (
    <div>
      <Label>
        {label}
        {required && ' *'}
      </Label>
      <Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required={required} />
    </div>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Thêm khách hàng">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        {field('code', 'Mã khách hàng (như trên MISA)', true)}
        {field('taxCode', 'Mã số thuế')}
        <div className="col-span-2">{field('name', 'Tên công ty', true)}</div>
        {field('industry', 'Ngành (electronics, food, steel…)')}
        {field('phone', 'Điện thoại')}
        <div className="col-span-2">{field('address', 'Địa chỉ / KCN')}</div>
        {error && <p className="col-span-2 text-sm text-rose-600">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit">Tạo</Button>
        </div>
      </form>
    </Dialog>
  );
}
