import { parse } from 'csv-parse/sync';

/** Parses CSV text (UTF-8, optional BOM, "," or ";" delimiter) into rows keyed by normalized header. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  return parse(clean, {
    columns: (header: string[]) => header.map(normalizeHeader),
    delimiter,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Parses numbers written the Vietnamese way (1.234.567,5) or the English way
 * (1,234,567.5). Returns null for empty / invalid input.
 */
export function parseNumber(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  let v = String(value).replace(/\s|đ|vnd/gi, '');
  if (!v) return null;
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    v = v.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    v = /^-?\d{1,3}(,\d{3})+$/.test(v) ? v.replace(/,/g, '') : v.replace(',', '.');
  } else if (lastDot >= 0) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
