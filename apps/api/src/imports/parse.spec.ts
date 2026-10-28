import { normalizeHeader, parseCsv, parseNumber } from './parse';

describe('parseNumber', () => {
  it.each([
    ['1.234.567', 1234567],
    ['1.234.567,5', 1234567.5],
    ['1,234,567.5', 1234567.5],
    ['1,234,567', 1234567],
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['250000', 250000],
    ['1.500.000 đ', 1500000],
    ['', null],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe('parseCsv', () => {
  it('normalizes Vietnamese headers and detects ";"', () => {
    const rows = parseCsv('﻿Mã KH;Tên khách hàng;Số lượng\nKH01;Công ty A;1.000\n');
    expect(rows).toEqual([{ ma_kh: 'KH01', ten_khach_hang: 'Công ty A', so_luong: '1.000' }]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('code,name\nKH02,"Công ty B, chi nhánh Bắc Ninh"\n')[0].name).toBe('Công ty B, chi nhánh Bắc Ninh');
  });

  it('normalizes headers', () => {
    expect(normalizeHeader(' Ngày Đặt Hàng ')).toBe('ngay_dat_hang');
  });
});
