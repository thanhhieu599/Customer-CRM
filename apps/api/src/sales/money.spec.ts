import { amount, fixed, priceQuote, formatAmount } from './money';
const line = { sku: 'GLV', productName: 'Găng tay', unit: 'đôi', quantity: '2.5', unitPrice: '100.01' };
describe('Quote fixed-point pricing', () => {
  it('rounds each line half-up and applies VAT after discount', () => {
    expect(priceQuote([line], '10.03', '8')).toMatchObject({
      subtotal: '250.03',
      discountAmount: '10.03',
      vatAmount: '19.20',
      total: '259.20',
    });
  });
  it('formats large persisted amounts without losing cents', () => {
    expect(formatAmount('9999999999999999.99')).toBe('9.999.999.999.999.999,99 VND');
  });
  it('keeps decimal sums exact', () => {
    expect(priceQuote([{ ...line, quantity: '3', unitPrice: '0.10' }], '0', '0').total).toBe('0.30');
    expect(amount(fixed('999999999999.99', 2))).toBe('999999999999.99');
  });
  it.each(['-1', 'NaN', 'Infinity', '1e4', '1.0001', ''])('rejects malformed price %s', (unitPrice) =>
    expect(() => priceQuote([{ ...line, unitPrice }])).toThrow(),
  );
  it('rejects zero quantity, excess discount, excessive VAT, empty lines and overflow', () => {
    expect(() => priceQuote([{ ...line, quantity: '0' }])).toThrow();
    expect(() => priceQuote([line], '9999')).toThrow();
    expect(() => priceQuote([line], '0', '100.01')).toThrow();
    expect(() => priceQuote([])).toThrow();
    expect(() => priceQuote([{ ...line, quantity: '999999999', unitPrice: '999999999999' }])).toThrow();
  });
});
