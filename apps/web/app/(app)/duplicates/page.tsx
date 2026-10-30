'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { useMe } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox, Empty, Loading, PageHeader } from '@/components/ui/misc';
interface Customer {
  id: string;
  code: string;
  name: string;
  taxCode: string | null;
  phone: string | null;
  email: string | null;
  address?: string | null;
  ownerId?: string | null;
  notes?: string | null;
  marketingConsent?: boolean;
}
interface Pair {
  source: Customer;
  target: Customer;
  reasons: string[];
}
interface Preview extends Pair {
  token: string;
  taxConflict: boolean;
  counts: Record<string, number>;
}
const COUNTS: Record<string, string> = {
  contacts: 'Người liên hệ',
  orders: 'Đơn hàng',
  activities: 'Hoạt động',
  tasks: 'Nhiệm vụ',
  tickets: 'Ticket',
  opportunities: 'Cơ hội',
  tags: 'Tag',
  executions: 'Lịch sử tự động',
  externalMappings: 'Mã đồng bộ',
};
export default function Page() {
  const { isManager, isLoading: loadingMe } = useMe();
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<{ items: Pair[]; scanned: number; total: number; truncated: boolean; pairLimit: number }>(
    isManager ? '/customer-duplicates' : null,
    fetcher,
  );
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [success, setSuccess] = useState('');
  async function inspect(sourceId: string, targetId: string) {
    setBusy(true);
    setError('');
    setConfirmed(false);
    try {
      setPreview(await api<Preview>('/customer-duplicates/preview', 'POST', { sourceId, targetId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function merge() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>('/customer-duplicates/merge', 'POST', {
        sourceId: preview.source.id,
        targetId: preview.target.id,
        token: preview.token,
      });
      setSuccess(result.id);
      setPreview(null);
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loadingMe) return <Loading />;
  if (!isManager) return <Empty>Chỉ quản lý có quyền xử lý khách trùng.</Empty>;
  return (
    <>
      <PageHeader
        title="Kiểm tra khách trùng"
        subtitle="Gợi ý theo mã số thuế, email, số điện thoại và tên chuẩn hóa. Luôn kiểm tra trước khi hợp nhất."
      />
      {(error || loadError) && <ErrorBox error={loadError ?? new Error(error)} />}
      {success && (
        <p className="mb-3 rounded border bg-emerald-50 p-3 text-sm">
          Đã hợp nhất.{' '}
          <Link className="text-primary underline" href={`/customers/${success}`}>
            Mở hồ sơ chính
          </Link>
        </p>
      )}
      {!data ? (
        <Loading />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Đã quét {data.scanned}/{data.total} khách; hiển thị tối đa {data.pairLimit} cặp gợi ý.
            {data.truncated && ' Danh sách chưa bao phủ toàn bộ dữ liệu.'}
          </p>
          <div className="space-y-3">
            {data.items.map((pair) => (
              <Card key={[pair.source.id, pair.target.id].sort().join(':')} className="space-y-3 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {[pair.source, pair.target].map((c) => (
                    <div key={c.id}>
                      <Link href={`/customers/${c.id}`} className="font-medium text-primary">
                        {c.code} · {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        MST: {c.taxCode ?? '—'} · {c.phone ?? '—'} · {c.email ?? '—'}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="text-xs">Dấu hiệu: {pair.reasons.join(', ')}</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void inspect(pair.source.id, pair.target.id)}
                  >
                    Giữ {pair.target.code} · Xem trước
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void inspect(pair.target.id, pair.source.id)}
                  >
                    Giữ {pair.source.code} · Xem trước
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          {!data.items.length && <Empty>Chưa phát hiện cặp trùng trong phạm vi đã quét.</Empty>}
        </>
      )}
      <Dialog open={!!preview} onClose={() => !busy && setPreview(null)} title="Xem trước hợp nhất khách">
        {preview && (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto">
            <p className="text-sm">
              <strong>Giữ hồ sơ {preview.target.code}</strong> ({preview.target.name}). Chuyển dữ liệu từ{' '}
              {preview.source.code} và ẩn hồ sơ nguồn.
            </p>
            <p className="text-xs text-muted-foreground">
              Giữ trường đã có ở hồ sơ chính; chỉ điền trường trống từ hồ sơ nguồn. Gộp ghi chú và tag, giữ lịch sử và
              liên kết; không tự xóa đơn hàng hoặc người liên hệ. Chỉ giữ đồng ý marketing khi cả hai hồ sơ đều đồng ý.
            </p>
            <div className="rounded border p-3 text-xs">
              {Object.entries(preview.counts).map(([key, value]) => (
                <div key={key} className="flex justify-between py-1">
                  <span>{COUNTS[key] ?? key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {preview.taxConflict && <ErrorBox error={new Error('Hai mã số thuế khác nhau. Không được hợp nhất.')} />}
            <p className="text-xs text-amber-800">
              Không có nút hoàn tác tự động. Hồ sơ nguồn và nhật ký trước hợp nhất được giữ để truy vết. Doanh thu, phân
              khúc và điểm sức khỏe được tính lại khi hợp nhất.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Tôi đã kiểm tra và xác nhận đây là cùng một khách hàng.
            </label>
            {error && <ErrorBox error={new Error(error)} />}
            <Button variant="danger" disabled={busy || !confirmed || preview.taxConflict} onClick={() => void merge()}>
              {busy ? 'Đang hợp nhất…' : 'Hợp nhất vào hồ sơ chính'}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
