'use client';
import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { api, fetcher, Paged } from '@/lib/api';
import { Opportunity, STAGES, localDateTime } from '@/lib/sales';
import { money, dateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/ui/misc';
function Pipeline() {
  const params = useSearchParams(),
    customerId = params.get('customerId') ?? '';
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [loss, setLoss] = useState<Opportunity | null>(null),
    [reason, setReason] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [form, setForm] = useState({
    customerId,
    title: '',
    value: '0',
    expectedCloseAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    nextActionAt: localDateTime(new Date(Date.now() + 86400000).toISOString()),
  });
  const {
    data,
    isLoading,
    error: loadError,
    mutate,
  } = useSWR<Paged<Opportunity>>(
    `/opportunities?${new URLSearchParams({ page: String(page), pageSize: '100', ...(customerId && { customerId }), ...(query && { q: query }) })}`,
    fetcher,
  );
  const { data: customers } = useSWR<Paged<{ id: string; name: string; code: string }>>(
    creating ? `/customers?${new URLSearchParams({ q: customerSearch, pageSize: '50' })}` : null,
    fetcher,
  );
  const change = async (opp: Opportunity, stage: string, lossReason?: string) => {
    if (busy || stage === opp.stage || ['WON', 'LOST'].includes(opp.stage)) return;
    if (stage === 'LOST' && !lossReason) {
      setLoss(opp);
      setReason('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/opportunities/${opp.id}`, 'PATCH', {
        version: opp.version,
        stage,
        ...(lossReason && { lossReason }),
      });
      setLoss(null);
      await mutate();
    } catch (e) {
      setError((e as Error).message);
      await mutate();
    } finally {
      setBusy(false);
    }
  };
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/opportunities', 'POST', { ...form, nextActionAt: new Date(form.nextActionAt).toISOString() });
      setCreating(false);
      setForm({ ...form, title: '', value: '0' });
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Pipeline cơ hội"
        subtitle="Kéo thả thẻ hoặc chọn giai đoạn. Quyền truy cập đi theo người phụ trách khách hàng."
        actions={
          <Button
            onClick={() => {
              setError('');
              setCreating(true);
            }}
          >
            Thêm cơ hội
          </Button>
        }
      />
      <Input
        className="mb-3 max-w-sm"
        aria-label="Tìm cơ hội"
        placeholder="Tìm tên cơ hội…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      {(error || loadError) && <ErrorBox error={loadError ?? new Error(error)} />}
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {data?.total ?? 0} cơ hội · Hiển thị {data?.items.length ?? 0} thẻ trên trang {page}
          </p>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Object.entries(STAGES).map(([stage, label]) => (
              <section
                key={stage}
                className="min-h-72 rounded-lg border bg-muted/40 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const opp = data?.items.find((o) => o.id === e.dataTransfer.getData('text/plain'));
                  if (opp) void change(opp, stage);
                }}
                aria-label={label}
              >
                <h2 className="mb-3 flex justify-between text-sm font-semibold">
                  {label}
                  <span>{data?.items.filter((o) => o.stage === stage).length ?? 0}</span>
                </h2>
                {data?.items
                  .filter((o) => o.stage === stage)
                  .map((opp) => (
                    <Card
                      key={opp.id}
                      className="mb-2 space-y-2 p-3"
                      draggable={!busy && !['WON', 'LOST'].includes(opp.stage)}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', opp.id)}
                    >
                      <Link
                        href={`/opportunities/${opp.id}`}
                        className="block text-sm font-semibold text-primary hover:underline"
                      >
                        {opp.title}
                      </Link>
                      <Link href={`/customers/${opp.customerId}`} className="block text-xs hover:underline">
                        {opp.customer.name}
                      </Link>
                      <div className="text-sm font-medium">{money(opp.value)}</div>
                      <div className="text-xs text-muted-foreground">{opp.customer.owner?.name ?? 'Chưa giao'}</div>
                      <div
                        className={`text-xs ${new Date(opp.nextActionAt) < new Date() && !['WON', 'LOST'].includes(opp.stage) ? 'text-rose-600' : 'text-muted-foreground'}`}
                      >
                        Theo dõi: {dateTime(opp.nextActionAt)}
                      </div>
                      {opp.lossReason && <p className="text-xs">Lý do: {opp.lossReason}</p>}
                      <Select
                        aria-label={`Giai đoạn ${opp.title}`}
                        value={opp.stage}
                        disabled={busy || ['WON', 'LOST'].includes(opp.stage)}
                        onChange={(e) => void change(opp, e.target.value)}
                      >
                        {Object.entries(STAGES).map(([key, value]) => (
                          <option key={key} value={key}>
                            {value}
                          </option>
                        ))}
                      </Select>
                    </Card>
                  ))}
              </section>
            ))}
          </div>
          {!data?.total && <Empty>Chưa có cơ hội. Hãy thêm cơ hội đầu tiên từ một khách hàng.</Empty>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Trước
            </Button>
            <Button variant="outline" disabled={page * 100 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
              Sau
            </Button>
          </div>
        </>
      )}
      <Dialog open={creating} onClose={() => !busy && setCreating(false)} title="Thêm cơ hội">
        <form onSubmit={create} className="space-y-3">
          <Label>
            Tìm khách hàng
            <Input
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Tên hoặc mã khách…"
            />
          </Label>
          <Label>
            Khách hàng
            <Select required value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">Chọn khách hàng</option>
              {customers?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Tên cơ hội
            <Input
              required
              minLength={3}
              maxLength={255}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Label>
          <Label>
            Giá trị dự kiến (VND)
            <Input
              required
              type="number"
              min="0"
              max="999999999999"
              step="0.01"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </Label>
          <Label>
            Ngày dự kiến chốt
            <Input
              required
              type="date"
              value={form.expectedCloseAt}
              onChange={(e) => setForm({ ...form, expectedCloseAt: e.target.value })}
            />
          </Label>
          <Label>
            Lần theo dõi tiếp theo
            <Input
              required
              type="datetime-local"
              value={form.nextActionAt}
              onChange={(e) => setForm({ ...form, nextActionAt: e.target.value })}
            />
          </Label>
          {error && <ErrorBox error={new Error(error)} />}
          <Button disabled={busy} type="submit">
            {busy ? 'Đang lưu…' : 'Tạo cơ hội'}
          </Button>
        </form>
      </Dialog>
      <Dialog open={!!loss} onClose={() => !busy && setLoss(null)} title="Ghi nhận lý do thua">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loss) void change(loss, 'LOST', reason);
          }}
          className="space-y-3"
        >
          <Label>
            Lý do
            <Input required minLength={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Label>
          {error && <ErrorBox error={new Error(error)} />}
          <Button disabled={busy}>Xác nhận thua</Button>
        </form>
      </Dialog>
    </>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Pipeline />
    </Suspense>
  );
}
