export const normalizeTax = (s?: string | null) => (s ?? '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
export const normalizeEmail = (s?: string | null) => (s ?? '').trim().toLowerCase();
export function normalizePhone(s?: string | null) {
  let phone = (s ?? '').replace(/\D/g, '');
  if (phone.startsWith('0084')) phone = `0${phone.slice(4)}`;
  else if (phone.startsWith('84')) phone = `0${phone.slice(2)}`;
  return phone.length >= 8 ? phone : '';
}
export const normalizeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export interface Identity {
  id: string;
  name: string;
  taxCode: string | null;
  phone: string | null;
  email: string | null;
}
export function duplicateReasons(a: Identity, b: Identity): string[] {
  const result: string[] = [];
  for (const [label, av, bv] of [
    ['Mã số thuế', normalizeTax(a.taxCode), normalizeTax(b.taxCode)],
    ['Email', normalizeEmail(a.email), normalizeEmail(b.email)],
    ['Điện thoại', normalizePhone(a.phone), normalizePhone(b.phone)],
    ['Tên tương tự', normalizeName(a.name), normalizeName(b.name)],
  ])
    if (av && av === bv) result.push(label);
  return result;
}
/** Indexed identity buckets avoid quadratic comparisons over unrelated customers. */
export function duplicatePairs<T extends Identity>(rows: T[], limit = 100) {
  const buckets = new Map<string, T[]>(),
    pairs = new Map<string, { source: T; target: T; reasons: string[] }>();
  for (const row of rows) {
    const keys = [
      normalizeTax(row.taxCode),
      normalizeEmail(row.email),
      normalizePhone(row.phone),
      normalizeName(row.name),
    ];
    keys.forEach((value, i) => {
      if (!value) return;
      const key = `${i}:${value}`,
        previous = buckets.get(key) ?? [];
      for (const other of previous) {
        const ids = [row.id, other.id].sort().join(':');
        if (!pairs.has(ids) && pairs.size < limit)
          pairs.set(ids, { source: row, target: other, reasons: duplicateReasons(row, other) });
      }
      if (previous.length < limit) previous.push(row);
      buckets.set(key, previous);
    });
  }
  return [...pairs.values()];
}
