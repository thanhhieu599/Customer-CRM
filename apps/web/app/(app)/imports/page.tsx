'use client';
import { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/misc';

interface Report {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

function Uploader({ kind, title, hint, onDone }: { kind: 'customers' | 'orders'; title: string; hint: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [system, setSystem] = useState('csv');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    setReport(null);
    const form = new FormData();
    form.append('file', file);
    try {
      setReport(await api<Report>(`/imports/${kind}?system=${system}${kind === 'orders' ? '&runEngine=true' : ''}`, 'POST', form));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Label>File CSV (UTF-8)</Label>
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-1.5" />
          </div>
          <div>
            <Label>Nguồn mã</Label>
            <Select value={system} onChange={(e) => setSystem(e.target.value)} className="w-28">
              <option value="csv">CSV</option>
              <option value="misa">MISA</option>
              <option value="sapo">Sapo</option>
            </Select>
          </div>
          <Button type="submit" disabled={!file || busy}>
            {busy ? 'Đang nhập…' : 'Nhập dữ liệu'}
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {report && (
          <div className="mt-3 rounded-md bg-muted/60 p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge>{report.rows} dòng</Badge>
              <Badge tone="emerald">{report.created} tạo mới</Badge>
              <Badge tone="blue">{report.updated} cập nhật</Badge>
              {report.skipped > 0 && <Badge>{report.skipped} gộp/bỏ qua</Badge>}
              {report.errors.length > 0 && <Badge tone="rose">{report.errors.length} lỗi</Badge>}
            </div>
            {report.errors.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs text-rose-700">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    Dòng {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ImportsPage() {
  const { data: logs, mutate } = useSWR<{ id: string; system: string; kind: string; status: string; stats: Report | null; startedAt: string }[]>('/imports/logs', fetcher);
  const tone = (s: string) => (s === 'SUCCESS' ? 'emerald' : s === 'PARTIAL' ? 'amber' : s === 'FAILED' ? 'rose' : 'slate');

  return (
    <>
      <PageHeader
        title="Nhập dữ liệu"
        subtitle="Tháng đầu dùng CSV xuất từ MISA / Excel. Nhập lại cùng file không tạo trùng (khớp theo mã chứng từ, mã KH, MST)."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Uploader
          kind="customers"
          title="1. Khách hàng & người liên hệ"
          hint="Cột bắt buộc: ma_kh, ten_khach_hang. Tùy chọn: ma_so_thue, nganh, phan_hang (A/B/C), nguoi_phu_trach (email NV), so_ngay_qua_han, nguoi_lien_he, chuc_vu, vai_tro, dien_thoai_lien_he… Mỗi người liên hệ một dòng. Mẫu: docs/import-templates/khach-hang.csv"
          onDone={mutate}
        />
        <Uploader
          kind="orders"
          title="2. Đơn hàng (mỗi dòng một mặt hàng)"
          hint="Cột bắt buộc: so_chung_tu, ma_kh, ngay_chung_tu (DD/MM/YYYY), ma_hang. Tùy chọn: ten_hang, dvt, so_luong, don_gia, thanh_tien, ngay_giao. Sau khi nhập, hệ thống tự chấm điểm và tạo việc chăm sóc. Mẫu: docs/import-templates/don-hang.csv"
          onDone={mutate}
        />
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Lịch sử đồng bộ</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Thời gian</Th>
              <Th>Loại</Th>
              <Th>Nguồn</Th>
              <Th>Kết quả</Th>
              <Th>Thống kê</Th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((l) => (
              <Tr key={l.id}>
                <Td>{dateTime(l.startedAt)}</Td>
                <Td>{l.kind === 'customers' ? 'Khách hàng' : 'Đơn hàng'}</Td>
                <Td className="uppercase">{l.system}</Td>
                <Td>
                  <Badge tone={tone(l.status)}>{l.status}</Badge>
                </Td>
                <Td className="text-xs">{l.stats ? `${l.stats.rows} dòng · ${l.stats.created} mới · ${l.stats.updated} cập nhật` : '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
