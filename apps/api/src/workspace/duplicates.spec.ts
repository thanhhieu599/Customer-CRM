import { duplicatePairs, duplicateReasons, normalizePhone } from './duplicates';
const a = { id: 'a', name: 'Công ty Đại Phát', taxCode: '01-234', phone: '0901 234 567', email: 'BUYER@EXAMPLE.COM' };
describe('Duplicate identity matching', () => {
  it('normalizes Vietnamese names, email, domestic and international phone numbers', () => {
    expect(
      duplicateReasons(a, {
        ...a,
        id: 'b',
        name: 'Cong ty Dai Phat',
        taxCode: '01234',
        phone: '+84 901234567',
        email: 'buyer@example.com ',
      }),
    ).toHaveLength(4);
    expect(normalizePhone('0084 901234567')).toBe('0901234567');
  });
  it('does not treat empty or short identities as evidence', () => {
    expect(
      duplicateReasons(
        { ...a, name: 'Alpha', phone: '12', email: null, taxCode: null },
        { ...a, id: 'b', name: 'Beta', phone: '12', email: null, taxCode: null },
      ),
    ).toEqual([]);
  });
  it('deduplicates pairs and caps large groups', () => {
    expect(duplicatePairs([a, { ...a, id: 'b' }])).toHaveLength(1);
    expect(
      duplicatePairs(
        Array.from({ length: 1000 }, (_, i) => ({ ...a, id: String(i) })),
        10,
      ),
    ).toHaveLength(10);
  });
});
