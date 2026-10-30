import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { formatAmount } from './money';
import { businessToday } from '../common/business-time';
interface PrintableQuote {
  number: string;
  version: number;
  status: string;
  validUntil: Date;
  customerSnapshot: unknown;
  items: unknown;
  subtotal: { toString(): string };
  discountAmount: { toString(): string };
  vatAmount: { toString(): string };
  total: { toString(): string };
  notes: string | null;
}
export async function quotePdf(quote: PrintableQuote): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 45, bufferPages: true });
  const font = [join(__dirname, 'assets/DejaVuSans.ttf'), join(process.cwd(), 'src/sales/assets/DejaVuSans.ttf')].find(
    existsSync,
  );
  if (!font) throw new Error('Thiếu font PDF tiếng Việt');
  doc.font(font);
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const c = quote.customerSnapshot as { name: string; code: string; taxCode?: string; address?: string };
  const money = (n: { toString(): string }) => formatAmount(n.toString());
  const text = (s: string, size = 10) => {
    doc.fontSize(size).text(s).moveDown(0.5);
  };
  text('CUSTOMER CARE CRM', 12);
  text(`BÁO GIÁ · Phiên bản ${quote.version}`, 20);
  text(`Số: ${quote.number}`);
  if (quote.status === 'DRAFT') text('BẢN NHÁP — CHƯA PHÁT HÀNH', 12);
  if (['SUPERSEDED', 'REJECTED'].includes(quote.status)) text('BẢN KHÔNG CÒN HIỆU LỰC', 12);
  text(`Khách hàng: ${c.name} (${c.code})`);
  text(`Mã số thuế: ${c.taxCode ?? '—'} · Địa chỉ: ${c.address ?? '—'}`);
  text(`Hiệu lực đến: ${quote.validUntil.toISOString().slice(0, 10)}`);
  if (quote.validUntil < businessToday()) text('ĐÃ HẾT THỜI HẠN BÁO GIÁ', 12);
  text('HÀNG HÓA / DỊCH VỤ', 12);
  for (const [i, line] of (
    quote.items as {
      sku: string;
      productName: string;
      quantity: string;
      unit: string;
      unitPrice: string;
      amount: string;
    }[]
  ).entries()) {
    if (doc.y > 680) doc.addPage();
    text(`${i + 1}. ${line.sku} — ${line.productName}`);
    text(`   ${line.quantity} ${line.unit} × ${money(line.unitPrice)} = ${money(line.amount)}`);
  }
  if (doc.y > 610) doc.addPage();
  text(`Tạm tính: ${money(quote.subtotal)}`);
  text(`Chiết khấu: ${money(quote.discountAmount)}`);
  text(`VAT: ${money(quote.vatAmount)}`);
  text(`TỔNG THANH TOÁN: ${money(quote.total)}`, 14);
  if (quote.notes) text(`Ghi chú: ${quote.notes}`);
  doc.end();
  return finished;
}
