'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { OUTCOME } from '@/lib/labels';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';

/** Closing a task requires a result – that is what makes the timeline and KPIs trustworthy. */
export function CompleteTaskDialog({ task, onClose, onDone }: { task: { id: string; title: string } | null; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState('');
  const [outcome, setOutcome] = useState('POSITIVE');
  const [activityType, setActivityType] = useState('CALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!task) return;
    setBusy(true);
    setError('');
    try {
      await api(`/tasks/${task.id}/complete`, 'POST', { result, outcome, activityType });
      setResult('');
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!task} onClose={onClose} title="Hoàn thành việc">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm font-medium">{task?.title}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Hình thức</Label>
            <Select value={activityType} onChange={(e) => setActivityType(e.target.value)}>
              <option value="CALL">Gọi điện</option>
              <option value="ZALO">Zalo</option>
              <option value="EMAIL">Email</option>
              <option value="VISIT">Thăm khách</option>
              <option value="MEETING">Họp</option>
              <option value="NOTE">Ghi chú</option>
            </Select>
          </div>
          <div>
            <Label>Kết quả</Label>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {Object.entries(OUTCOME).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label>Nội dung trao đổi / kết quả *</Label>
          <Textarea value={result} onChange={(e) => setResult(e.target.value)} required minLength={3} placeholder="VD: Khách xác nhận PO 2.000 đôi găng ESD, giao trước 15/11" />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={busy}>
            Lưu kết quả
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
