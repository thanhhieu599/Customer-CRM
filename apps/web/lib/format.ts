export const vnd = (n: number | string | null | undefined) =>
  n === null || n === undefined ? '—' : `${Math.round(Number(n)).toLocaleString('vi-VN')} đ`;

/** Short money: 1,2 tỷ / 350 tr */
export const money = (n: number | string | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return vnd(v);
};

export const date = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

export const dateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' })
    : '—';

export const daysAgo = (d: string | Date | null | undefined) => {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
};

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('vi-VN')}%`);
