'use client';
import Link from 'next/link';
import { FormEvent, use, useEffect, useState } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { localDateTime, Opportunity, Quote, QuoteLine, QUOTE_STATUS, STAGES, quoteMoney } from '@/lib/sales';
import { dateTime, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorBox, Loading, PageHeader } from '@/components/ui/misc';
const blank: QuoteLine = { sku: '', productName: '', unit: 'cái', quantity: '1', unitPrice: '0' };
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error: loadError, mutate } = useSWR<Opportunity>(`/opportunities/${id}`, fetcher);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  const [items, setItems] = useState<QuoteLine[]>([{ ...blank }]);
  const [quote, setQuote] = useState({
    discountAmount: '0',
    vatPercent: '8',
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    followUpAt: localDateTime(new Date(Date.now() + 2 * 86400000).toISOString()),
    notes: '',
  });
  const [nextActionAt, setNextActionAt] = useState(''),
    [expectedCloseAt, setExpectedCloseAt] = useState('');
  useEffect(() => {
    if (data) {
      setNextActionAt(localDateTime(data.nextActionAt));
      setExpectedCloseAt(data.expectedCloseAt.slice(0, 10));
    }
  }, [data]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await mutate();
    } catch (e) {
      setError((e as Error).message);
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api(`/opportunities/${id}/quotes`, 'POST', {
        ...quote,
        items,
        followUpAt: new Date(quote.followUpAt).toISOString(),
      });
      setEditing(false);
    });
  }
  function revision(previous?: Quote) {
    setError('');
    setItems(
      previous
        ? previous.items.map(({ sku, productName, unit, quantity, unitPrice }) => ({
            sku,
            productName,
            unit,
            quantity,
            unitPrice,
          }))
        : [{ ...blank }],
    );
    if (previous)
      setQuote((q) => ({
        ...q,
        discountAmount: previous.discountAmount,
        vatPercent: previous.vatPercent,
        notes: previous.notes ?? '',
      }));
    setEditing(true);
  }
  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <Loading />;
  const closed = ['WON', 'LOST'].includes(data.stage),
    latest = data.quotes[0];
  return (
    <>
      <PageHeader
        title={data.title}
        subtitle={
          <>
            <Link className="text-primary hover:underline" href={`/customers/${data.customerId}`}>
              {data.customer.name}
            </Link>{' '}
            · {STAGES[data.stage]} · {money(data.value)}
          </>
        }
        actions={
          <Link className="text-sm text-primary" href="/opportunities">
            ← Pipeline
          </Link>
        }
      />
      {error && <ErrorBox error={new Error(error)} />}
      {!closed && (
        <Card className="mb-4 p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api(`/opportunities/${id}`, 'PATCH', {
                  version: data.version,
                  nextActionAt: new Date(nextActionAt).toISOString(),
                  expectedCloseAt,
                }),
              );
            }}
          >
            <Label>
              Lần theo dõi tiếp theo
              <Input
                required
                type="datetime-local"
                value={nextActionAt}
                onChange={(e) => setNextActionAt(e.target.value)}
              />
            </Label>
            <Label>
              Ngày dự kiến chốt
              <Input
                required
                type="date"
                value={expectedCloseAt}
                onChange={(e) => setExpectedCloseAt(e.target.value)}
              />
            </Label>
            <Button disabled={busy}>Lưu lịch</Button>
          </form>
        </Card>
      )}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Báo giá & phiên bản</h2>
        {!closed && latest?.status !== 'DRAFT' && (
          <Button disabled={busy} onClick={() => revision(latest)}>
            {latest ? 'Lập phiên bản mới' : 'Lập báo giá'}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        “Đánh dấu đã gửi” ghi nhận việc bạn đã gửi cho khách và tạo nhiệm vụ theo dõi; hệ thống chưa tự gửi email/Zalo.
        Khách đồng ý sẽ đóng cơ hội thành Thắng, chưa tạo đơn hàng.
      </p>
      {editing && (
        <Card className="mb-4 p-4">
          <form onSubmit={submit} className="space-y-4">
            <h3 className="font-medium">Báo giá mới · VND</h3>
            {items.map((line, i) => (
              <div key={i} className="grid grid-cols-2 items-end gap-2 rounded border p-3 lg:grid-cols-6">
                {(['sku', 'productName', 'unit', 'quantity', 'unitPrice'] as const).map((key, j) => (
                  <Label key={key}>
                    {['Mã hàng', 'Tên hàng', 'Đơn vị', 'Số lượng', 'Đơn giá'][j]}
                    <Input
                      required
                      aria-label={`${key}-${i}`}
                      value={line[key]}
                      type={j > 2 ? 'number' : 'text'}
                      min={key === 'quantity' ? '0.001' : '0'}
                      step={key === 'quantity' ? '0.001' : '0.01'}
                      maxLength={key === 'productName' ? 255 : 100}
                      onChange={(e) =>
                        setItems(items.map((v, index) => (index === i ? { ...v, [key]: e.target.value } : v)))
                      }
                    />
                  </Label>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={items.length === 1}
                  onClick={() => setItems(items.filter((_, index) => index !== i))}
                >
                  Xóa dòng
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={items.length >= 100}
              onClick={() => setItems([...items, { ...blank }])}
            >
              Thêm hàng
            </Button>
            <div className="grid gap-3 md:grid-cols-4">
              <Label>
                Chiết khấu (VND)
                <Input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={quote.discountAmount}
                  onChange={(e) => setQuote({ ...quote, discountAmount: e.target.value })}
                />
              </Label>
              <Label>
                VAT (%)
                <Input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={quote.vatPercent}
                  onChange={(e) => setQuote({ ...quote, vatPercent: e.target.value })}
                />
              </Label>
              <Label>
                Hiệu lực đến
                <Input
                  required
                  type="date"
                  value={quote.validUntil}
                  onChange={(e) => setQuote({ ...quote, validUntil: e.target.value })}
                />
              </Label>
              <Label>
                Theo dõi lúc
                <Input
                  required
                  type="datetime-local"
                  value={quote.followUpAt}
                  onChange={(e) => setQuote({ ...quote, followUpAt: e.target.value })}
                />
              </Label>
            </div>
            <Label>
              Ghi chú
              <Textarea
                maxLength={4000}
                value={quote.notes}
                onChange={(e) => setQuote({ ...quote, notes: e.target.value })}
              />
            </Label>
            <p className="text-xs text-muted-foreground">Tổng tiền được tính và làm tròn tại hệ thống sau khi lưu.</p>
            <div className="flex gap-2">
              <Button disabled={busy}>Lưu bản nháp</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
                Hủy
              </Button>
            </div>
          </form>
        </Card>
      )}
      <div className="space-y-3">
        {data.quotes.map((q) => (
          <Card key={q.id} className="space-y-3 p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <strong>Phiên bản {q.version}</strong> <Badge>{QUOTE_STATUS[q.status]}</Badge>
                <p className="mt-1 break-all text-xs text-muted-foreground">{q.number}</p>
              </div>
              <div className="font-semibold">{quoteMoney(q.total)}</div>
            </div>
            <div className="text-sm">
              {q.items.map((line, i) => (
                <div key={i} className="flex flex-wrap justify-between gap-2 border-b py-1">
                  <span>
                    {line.sku} · {line.productName}
                  </span>
                  <span>
                    {line.quantity} {line.unit} × {quoteMoney(line.unitPrice)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Hiệu lực: {q.validUntil.slice(0, 10)} · Theo dõi: {dateTime(q.followUpAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/quotes/${q.id}/pdf`}
                className="inline-flex h-8 items-center rounded border px-3 text-xs hover:bg-muted"
              >
                Tải PDF
              </a>
              {!closed && (q.status === 'SENT' || latest?.id === q.id) && (
                <>
                  {q.status === 'DRAFT' && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => api(`/quotes/${q.id}/status`, 'PATCH', { status: 'SENT' }))}
                    >
                      Đánh dấu đã gửi
                    </Button>
                  )}
                  {q.status === 'SENT' && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (confirm('Xác nhận khách đồng ý báo giá và đóng cơ hội thành Thắng?'))
                          void run(() => api(`/quotes/${q.id}/status`, 'PATCH', { status: 'ACCEPTED' }));
                      }}
                    >
                      Khách đồng ý
                    </Button>
                  )}
                  {['DRAFT', 'SENT'].includes(q.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => api(`/quotes/${q.id}/status`, 'PATCH', { status: 'REJECTED' }))}
                    >
                      Từ chối / bỏ bản này
                    </Button>
                  )}
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
      {!data.quotes.length && !editing && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Chưa có báo giá cho cơ hội này.</Card>
      )}
    </>
  );
}
