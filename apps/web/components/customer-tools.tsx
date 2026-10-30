'use client';
import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { api, fetcher } from '@/lib/api';
import { useMe, useUsers } from '@/lib/session';
import { Button } from './ui/button';
import { Input, Label, Select } from './ui/input';
import { Dialog } from './ui/dialog';
import { ErrorBox } from './ui/misc';
interface Saved {
  id: string;
  name: string;
  filters: Record<string, string>;
}
export function CustomerTools({
  filters,
  selected,
  apply,
  onDone,
}: {
  filters: Record<string, string | number>;
  selected: string[];
  apply: (filters: Record<string, string>) => void;
  onDone: () => void;
}) {
  const { isManager } = useMe(),
    users = useUsers();
  const { data: saved, mutate } = useSWR<Saved[]>('/saved-filters', fetcher);
  const [filterId, setFilterId] = useState(''),
    [name, setName] = useState(''),
    [saving, setSaving] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [action, setAction] = useState('task'),
    [assigneeId, setAssigneeId] = useState(''),
    [tags, setTags] = useState(''),
    [title, setTitle] = useState(''),
    [dueAt, setDueAt] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/saved-filters', 'POST', {
        name,
        filters: Object.fromEntries(
          Object.entries(filters)
            .filter(([k, v]) => !['page', 'pageSize'].includes(k) && v !== '')
            .map(([k, v]) => [k, String(v)]),
        ),
      });
      await mutate();
      setSaving(false);
      setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function bulk() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ count: number }>('/customers/bulk', 'POST', {
        ids: selected,
        action,
        ...(assigneeId && { assigneeId }),
        ...(action === 'tag' && {
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
        ...(action === 'task' && { title, dueAt: new Date(dueAt).toISOString() }),
      });
      setMessage(`Đã xử lý ${result.count} khách hàng.`);
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Select
          className="w-52"
          aria-label="Bộ lọc đã lưu"
          value={filterId}
          onChange={(e) => {
            setFilterId(e.target.value);
            const f = saved?.find((s) => s.id === e.target.value);
            if (f) apply(f.filters);
          }}
        >
          <option value="">Bộ lọc đã lưu</option>
          {saved?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button
          variant="outline"
          onClick={() => {
            setError('');
            setSaving(true);
          }}
        >
          Lưu bộ lọc hiện tại
        </Button>
        {filterId && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/saved-filters/${filterId}`, 'DELETE');
                setFilterId('');
                await mutate();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Xóa bộ lọc
          </Button>
        )}
        {isManager && (
          <Link href="/duplicates" className="inline-flex items-center px-3 text-sm text-primary">
            Kiểm tra khách trùng
          </Link>
        )}
      </div>
      {!!selected.length && (
        <div className="flex flex-wrap items-center gap-3 rounded border bg-primary/5 p-3 text-sm">
          <strong>Đã chọn {selected.length} khách trên trang này</strong>
          <Button
            size="sm"
            onClick={() => {
              setError('');
              setOpen(true);
            }}
          >
            Thao tác hàng loạt
          </Button>
          <span className="text-xs text-muted-foreground">
            Tối đa 100 khách mỗi lần; chỉ xử lý khi toàn bộ danh sách hợp lệ.
          </span>
        </div>
      )}
      {error && <ErrorBox error={new Error(error)} />}
      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      <Dialog open={saving} onClose={() => !busy && setSaving(false)} title="Lưu bộ lọc riêng của tôi">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label>
            Tên bộ lọc
            <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Label>
          <p className="text-xs text-muted-foreground">
            Lưu điều kiện tìm kiếm và sắp xếp. Cùng tên sẽ cập nhật bộ lọc cũ.
          </p>
          {error && <ErrorBox error={new Error(error)} />}
          <Button disabled={busy}>Lưu bộ lọc</Button>
        </form>
      </Dialog>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title={`Xử lý ${selected.length} khách hàng`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void bulk();
          }}
        >
          <Label>
            Thao tác
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="task">Giao việc chăm sóc</option>
              <option value="tag">Thêm tag</option>
              {isManager && <option value="assign">Chuyển người phụ trách</option>}
            </Select>
          </Label>
          {action === 'tag' ? (
            <Label>
              Tag (phân cách bằng dấu phẩy)
              <Input required maxLength={1000} value={tags} onChange={(e) => setTags(e.target.value)} />
            </Label>
          ) : (
            <>
              {isManager && (
                <Label>
                  Người phụ trách
                  <Select
                    required={action === 'assign'}
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                  >
                    <option value="">
                      {action === 'task' ? 'Theo người phụ trách từng khách' : 'Chọn người phụ trách'}
                    </option>
                    {users
                      .filter((u) => u.isActive)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </Select>
                </Label>
              )}
              {action === 'task' && (
                <>
                  <Label>
                    Tiêu đề công việc
                    <Input
                      required
                      minLength={3}
                      maxLength={255}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </Label>
                  <Label>
                    Hạn công việc
                    <Input required type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                  </Label>
                </>
              )}
            </>
          )}
          {action === 'assign' && (
            <p className="text-xs text-amber-800">
              Quyền truy cập khách, cơ hội và báo giá chuyển theo người phụ trách mới. Nhiệm vụ đã giao vẫn giữ người
              thực hiện.
            </p>
          )}
          {error && <ErrorBox error={new Error(error)} />}
          <Button disabled={busy}>{busy ? 'Đang xử lý…' : 'Áp dụng cho danh sách đã chọn'}</Button>
        </form>
      </Dialog>
    </div>
  );
}
