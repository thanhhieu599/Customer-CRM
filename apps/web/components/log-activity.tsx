'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { OUTCOME } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';

export function LogActivity({ customerId, contacts, onSaved }: { customerId: string; contacts: { id: string; name: string }[]; onSaved: () => void }) {
  const [type, setType] = useState('CALL');
  const [outcome, setOutcome] = useState('');
  const [contactId, setContactId] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/activities', 'POST', { customerId, type, content, outcome: outcome || undefined, contactId: contactId || undefined });
      setContent('');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại tương tác">
          <option value="CALL">Cuộc gọi</option>
          <option value="ZALO">Zalo</option>
          <option value="EMAIL">Email</option>
          <option value="VISIT">Thăm khách</option>
          <option value="MEETING">Họp</option>
          <option value="NOTE">Ghi chú</option>
        </Select>
        <Select value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Người liên hệ">
          <option value="">— Người liên hệ —</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Kết quả">
          <option value="">— Kết quả —</option>
          {Object.entries(OUTCOME).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      <Textarea value={content} onChange={(e) => setContent(e.target.value)} required minLength={2} placeholder="Nội dung trao đổi, nhu cầu, hẹn lần sau…" />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy}>
          Ghi nhận chăm sóc
        </Button>
      </div>
    </form>
  );
}
