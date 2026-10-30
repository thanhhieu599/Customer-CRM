export const STAGES: Record<string, string> = {
  NEW: 'Mới',
  QUALIFIED: 'Xác định nhu cầu',
  QUOTED: 'Báo giá',
  NEGOTIATION: 'Đàm phán',
  WON: 'Thắng',
  LOST: 'Thua',
};
export const QUOTE_STATUS: Record<string, string> = {
  DRAFT: 'Bản nháp',
  SENT: 'Đã gửi',
  ACCEPTED: 'Khách đồng ý',
  REJECTED: 'Từ chối',
  SUPERSEDED: 'Đã thay thế',
};
export interface Quote {
  id: string;
  number: string;
  version: number;
  status: string;
  total: string;
  validUntil: string;
  followUpAt: string;
  notes: string | null;
  items: QuoteLine[];
  discountAmount: string;
  vatPercent: string;
}
export interface QuoteLine {
  sku: string;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}
export interface Opportunity {
  id: string;
  title: string;
  stage: string;
  value: string;
  version: number;
  expectedCloseAt: string;
  nextActionAt: string;
  lossReason: string | null;
  customerId: string;
  customer: { id: string; name: string; owner?: { name: string } | null };
  quotes: Quote[];
}
export function localDateTime(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Exact VND display for quotes; dashboard amounts remain abbreviated. */
export function quoteMoney(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return `${BigInt(whole).toLocaleString('vi-VN')}${fraction && Number(fraction) !== 0 ? `,${fraction.padEnd(2, '0')}` : ''} đ`;
}
