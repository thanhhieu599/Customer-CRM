/** Fixed-point arithmetic: VND amounts retain two decimal places; quantities three. */
export function fixed(value: string, digits: number): bigint {
  if (!new RegExp(`^\\d{1,12}(?:\\.\\d{1,${digits}})?$`).test(value))
    throw new Error('Số tiền hoặc số lượng không hợp lệ');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'));
}
export const amount = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
export interface QuoteLine {
  sku: string;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}
export function priceQuote(lines: QuoteLine[], discount = '0', vat = '0') {
  if (!lines.length || lines.length > 100) throw new Error('Báo giá cần từ 1 đến 100 dòng hàng');
  const items = lines.map((line) => {
    const quantity = fixed(line.quantity, 3),
      price = fixed(line.unitPrice, 2);
    if (quantity <= 0n) throw new Error('Số lượng phải lớn hơn 0');
    return { ...line, amount: amount((quantity * price + 500n) / 1000n) };
  });
  const subtotal = items.reduce((sum, line) => sum + fixed(line.amount, 2), 0n);
  const discountAmount = fixed(discount, 2),
    vatPercent = fixed(vat, 2);
  if (discountAmount > subtotal || vatPercent > 10000n) throw new Error('Chiết khấu hoặc VAT vượt giới hạn');
  const taxable = subtotal - discountAmount;
  const vatAmount = (taxable * vatPercent + 5000n) / 10000n;
  if (taxable + vatAmount >= 10n ** 18n) throw new Error('Tổng tiền vượt giới hạn');
  return {
    items,
    subtotal: amount(subtotal),
    discountAmount: amount(discountAmount),
    vatAmount: amount(vatAmount),
    total: amount(taxable + vatAmount),
    vatPercent: amount(vatPercent),
  };
}

/** Format a persisted decimal without converting large amounts to floating point. */
export function formatAmount(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${BigInt(whole).toLocaleString('vi-VN')}${fraction && Number(fraction) !== 0 ? `,${fraction.padEnd(2, '0')}` : ''} VND`;
}
