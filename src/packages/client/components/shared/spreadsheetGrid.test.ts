import { describe, it, expect } from 'vitest';
import {
  columnLabel,
  computeMultiSelectionStats,
  computeSelectionStats,
  describeDelimiter,
  estimateColumnWidths,
  filterRowIndices,
  formatBadge,
  formatExtent,
  formatStat,
  gridToTsv,
  isNumericCell,
  normalizeRange,
  parseNumericCell,
  rangeToTsv,
  rangesContain,
  rangesToTsv,
  sortRowIndices,
  visibleColumnCount,
} from './spreadsheetGrid';

describe('spreadsheetGrid helpers', () => {
  it('labels columns like a spreadsheet', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(27)).toBe('AB');
    expect(columnLabel(701)).toBe('ZZ');
    expect(columnLabel(702)).toBe('AAA');
  });

  it('renders at least the reported width, capped, and never zero for data', () => {
    expect(visibleColumnCount([['a', 'b'], ['c']], 2, 100)).toBe(2);
    // Server says 8 columns exist but the stored rows are narrower (sparse) → pad to 8.
    expect(visibleColumnCount([['a']], 8, 100)).toBe(8);
    // Reported width beyond the cap → the cap; a stored row can't exceed it anyway.
    expect(visibleColumnCount([['a']], 150, 100)).toBe(100);
    expect(visibleColumnCount([[]], 0, 100)).toBe(1);
    expect(visibleColumnCount([], 0, 100)).toBe(0);
  });

  it('detects numeric cells (thousands, currency, percent, negatives)', () => {
    for (const v of ['42', '-42', '1,234.5', '$1,000', '25.6%', '(12)', '1 234,56', '0.00001']) {
      expect(isNumericCell(v), v).toBe(true);
    }
    for (const v of ['', 'abc', '2026-08-18', '12:30', 'TRUE', '#N/A', '3 apples']) {
      expect(isNumericCell(v), v).toBe(false);
    }
  });

  it('dumps the grid as TSV with quoting for tabs/newlines', () => {
    expect(gridToTsv([['a', 'b'], ['c']], 2)).toBe('a\tb\nc\t');
    expect(gridToTsv([['x\ty', 'multi\nline', 'say "hi"']], 3)).toBe('"x\ty"\t"multi\nline"\t"say ""hi"""');
  });

  it('marks estimated extents', () => {
    expect(formatExtent(1234, 8)).toBe(`${(1234).toLocaleString()} × 8`);
    expect(formatExtent(1234, 8, true)).toBe(`≈ ${(1234).toLocaleString()} × 8`);
  });

  it('describes delimiters and format badges', () => {
    expect(describeDelimiter(';')).toBe('semicolon');
    expect(describeDelimiter('\t')).toBe('tab');
    expect(describeDelimiter(undefined)).toBeNull();
    expect(formatBadge({ format: 'xlsx', extension: '.xlsm' })).toBe('XLSM');
    expect(formatBadge({ format: 'csv', extension: '.csv' })).toBe('CSV');
  });
});

describe('parseNumericCell', () => {
  it('reads plain, thousands, decimal-comma, currency, percent and accounting negatives', () => {
    expect(parseNumericCell('42')).toEqual({ value: 42, percent: false });
    expect(parseNumericCell('-42.5')).toEqual({ value: -42.5, percent: false });
    expect(parseNumericCell('1,234.5')).toEqual({ value: 1234.5, percent: false });
    expect(parseNumericCell('1.234.567,89')).toEqual({ value: 1234567.89, percent: false });
    expect(parseNumericCell('1 234,56')).toEqual({ value: 1234.56, percent: false });
    expect(parseNumericCell('1,5')).toEqual({ value: 1.5, percent: false });
    expect(parseNumericCell('1,234')).toEqual({ value: 1234, percent: false });
    expect(parseNumericCell('$1,000')).toEqual({ value: 1000, percent: false });
    expect(parseNumericCell('61530.00')).toEqual({ value: 61530, percent: false });
    expect(parseNumericCell('25.6%')).toEqual({ value: 25.6, percent: true });
    expect(parseNumericCell('(12)')).toEqual({ value: -12, percent: false });
    expect(parseNumericCell('0.00001')).toEqual({ value: 0.00001, percent: false });
  });

  it('rejects dates, times, booleans, errors and text', () => {
    for (const v of ['', '2026-08-18', '12:30', '10:26:52,313', '13/03/2026', 'TRUE', '#N/A', '3 apples', 'abc', '1-2']) {
      expect(parseNumericCell(v), v).toBeNull();
    }
  });
});

describe('selection stats + helpers', () => {
  const rows = [
    ['name', 'qty', 'price', 'pct'],
    ['a', '3', '19.99', '25%'],
    ['b', '12', '0.3', '75%'],
    ['c', '', 'n/a', ''],
    ['d', '1,000', '-5', '100%'],
  ];
  const display = [0, 1, 2, 3, 4];

  it('computes count / numbers / sum / avg / min / max over a range of displayed rows', () => {
    const range = normalizeRange({ r: 1, c: 1 }, { r: 4, c: 2 });
    const s = computeSelectionStats(rows, display, range);
    expect(s.cells).toBe(8);
    expect(s.nonEmpty).toBe(7);
    expect(s.numbers).toBe(6);
    expect(s.sum).toBeCloseTo(3 + 19.99 + 12 + 0.3 + 1000 - 5, 6);
    expect(s.min).toBe(-5);
    expect(s.max).toBe(1000);
    expect(s.allPercent).toBe(false);
  });

  it('flags all-percent selections so the bar shows %', () => {
    const s = computeSelectionStats(rows, display, normalizeRange({ r: 1, c: 3 }, { r: 4, c: 3 }));
    expect(s.numbers).toBe(3);
    expect(s.sum).toBe(200);
    expect(s.allPercent).toBe(true);
    expect(formatStat(s.sum, s.allPercent)).toBe('200%');
  });

  it('respects the display order (filtered/sorted rows), not source order', () => {
    const s = computeSelectionStats(rows, [4, 2], normalizeRange({ r: 0, c: 1 }, { r: 1, c: 1 }));
    expect(s.sum).toBe(1012);
  });

  it('formats stats compactly', () => {
    expect(formatStat(0.1 + 0.2)).toBe('0.3');
    expect(formatStat(1234567.891)).toBe((1234567.891).toLocaleString(undefined, { maximumFractionDigits: 6 }));
  });

  it('filters rows by substring across all cells', () => {
    expect(filterRowIndices(rows, '')).toEqual([0, 1, 2, 3, 4]);
    expect(filterRowIndices(rows, 'N/A')).toEqual([3]);
    expect(filterRowIndices(rows, '%')).toEqual([1, 2, 4]);
    expect(filterRowIndices(rows, 'zzz')).toEqual([]);
  });

  it('sorts numerically when numbers, text otherwise, empties last, stable', () => {
    expect(sortRowIndices(rows, [1, 2, 3, 4], 1, 'asc')).toEqual([1, 2, 4, 3]);
    expect(sortRowIndices(rows, [1, 2, 3, 4], 1, 'desc')).toEqual([4, 2, 1, 3]);
    expect(sortRowIndices(rows, [1, 2, 3, 4], 0, 'desc')).toEqual([4, 3, 2, 1]);
  });

  it('dumps a selection over displayed rows as TSV', () => {
    expect(rangeToTsv(rows, [4, 1], normalizeRange({ r: 0, c: 0 }, { r: 1, c: 1 }))).toBe('d\t1,000\na\t3');
  });

  it('estimates column widths from the longest line, clamped', () => {
    const w = estimateColumnWidths([['ab', 'x'.repeat(200), 'multi\nlonger line here', '']], 4, { min: 56, max: 320, charPx: 7.2 });
    expect(w[0]).toBe(56);
    expect(w[1]).toBe(320);
    expect(w[2]).toBe(Math.round('longer line here'.length * 7.2 + 18));
    expect(w[3]).toBe(56);
  });
});

describe('multi-range selection (Ctrl+click)', () => {
  const rows = [
    ['a', '1', '10'],
    ['b', '2', '20'],
    ['c', '3', '30'],
  ];
  const display = [0, 1, 2];

  it('sums disjoint ranges', () => {
    const s = computeMultiSelectionStats(rows, display, [normalizeRange({ r: 0, c: 1 }, { r: 0, c: 1 }), normalizeRange({ r: 2, c: 2 }, { r: 2, c: 2 })]);
    expect(s.cells).toBe(2);
    expect(s.sum).toBe(31);
  });

  it('does not double count overlapping ranges', () => {
    const col = normalizeRange({ r: 0, c: 1 }, { r: 2, c: 1 });   // whole column B: 1+2+3
    const row = normalizeRange({ r: 1, c: 0 }, { r: 1, c: 2 });   // whole row 2: b,2,20
    const s = computeMultiSelectionStats(rows, display, [col, row]);
    expect(s.cells).toBe(5);        // 3 + 3 - 1 shared
    expect(s.sum).toBe(1 + 2 + 3 + 20);
    expect(s.numbers).toBe(4);
  });

  it('copies ranges as blocks', () => {
    expect(rangesToTsv(rows, display, [normalizeRange({ r: 0, c: 0 }, { r: 0, c: 1 }), normalizeRange({ r: 2, c: 2 }, { r: 2, c: 2 })])).toBe('a\t1\n\n30');
    expect(rangesContain([normalizeRange({ r: 0, c: 0 }, { r: 0, c: 0 })], 0, 0)).toBe(true);
    expect(rangesContain([normalizeRange({ r: 0, c: 0 }, { r: 0, c: 0 })], 1, 0)).toBe(false);
  });
});
