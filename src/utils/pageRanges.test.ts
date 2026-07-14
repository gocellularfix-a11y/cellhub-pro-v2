// R-2.1.4-PRINT-PAGES — canonical page-range parser tests.
// An invalid selection must NEVER resolve to "print everything".
import { describe, it, expect } from 'vitest';
import { parsePageRanges, pagesBeyondCount, countSelectedPages, toPrintToPdfRangeString } from './pageRanges';

function ok(input: string) {
  const r = parsePageRanges(input);
  if (!r.ok) throw new Error(`expected ok for "${input}", got ${JSON.stringify(r)}`);
  return r.ranges;
}
function err(input: string) {
  const r = parsePageRanges(input);
  if (r.ok) throw new Error(`expected error for "${input}", got ${JSON.stringify(r)}`);
  return r.error;
}

describe('parsePageRanges — valid inputs', () => {
  it('“1” → single page', () => {
    expect(ok('1')).toEqual([{ from: 1, to: 1 }]);
  });

  it('“1-3” → contiguous range', () => {
    expect(ok('1-3')).toEqual([{ from: 1, to: 3 }]);
  });

  it('“1,3-4” → non-contiguous selection', () => {
    expect(ok('1,3-4')).toEqual([{ from: 1, to: 1 }, { from: 3, to: 4 }]);
  });

  it('whitespace is accepted everywhere', () => {
    expect(ok('  1 ,  3 - 4 ')).toEqual([{ from: 1, to: 1 }, { from: 3, to: 4 }]);
    expect(ok(' 2 ')).toEqual([{ from: 2, to: 2 }]);
  });

  it('duplicate pages are normalized away', () => {
    expect(ok('2,2,2')).toEqual([{ from: 2, to: 2 }]);
    expect(ok('1,1-2,2')).toEqual([{ from: 1, to: 2 }]);
  });

  it('overlapping and adjacent ranges are merged', () => {
    expect(ok('1-3,2-5')).toEqual([{ from: 1, to: 5 }]);
    expect(ok('1-2,3-4')).toEqual([{ from: 1, to: 4 }]);
    expect(ok('5-6,1-2')).toEqual([{ from: 1, to: 2 }, { from: 5, to: 6 }]);
  });
});

describe('parsePageRanges — rejected inputs', () => {
  it('empty input is rejected (never “print all” by default)', () => {
    expect(err('')).toBe('empty');
    expect(err('   ')).toBe('empty');
  });

  it('page zero is rejected', () => {
    expect(err('0')).toBe('zero');
    expect(err('0-2')).toBe('zero');
  });

  it('negative pages are rejected', () => {
    expect(err('-2')).toBe('negative');
    expect(err('1,-3')).toBe('negative');
  });

  it('reversed subranges like “4-2” are rejected', () => {
    expect(err('4-2')).toBe('reversed');
    expect(err('1,4-2')).toBe('reversed');
  });

  it('non-numeric input is rejected', () => {
    expect(err('abc')).toBe('syntax');
    expect(err('1,x')).toBe('syntax');
    expect(err('1..3')).toBe('syntax');
    expect(err('1-2-3')).toBe('syntax');
    expect(err('1,')).toBe('syntax');
  });
});

describe('bounds and helpers', () => {
  it('pages beyond the document page count are identified', () => {
    expect(pagesBeyondCount(ok('1,3-4'), 4)).toEqual([]);
    expect(pagesBeyondCount(ok('5'), 4)).toEqual([5]);
    expect(pagesBeyondCount(ok('3-6'), 4)).toEqual([5, 6]);
    expect(pagesBeyondCount(ok('1'), 0)).toEqual([1]);
  });

  it('countSelectedPages counts exactly', () => {
    expect(countSelectedPages(ok('1'))).toBe(1);
    expect(countSelectedPages(ok('2-3'))).toBe(2);
    expect(countSelectedPages(ok('1,3-4'))).toBe(3);
  });

  it('toPrintToPdfRangeString emits the 1-based printToPDF form', () => {
    expect(toPrintToPdfRangeString(ok('1'))).toBe('1');
    expect(toPrintToPdfRangeString(ok('2-3'))).toBe('2-3');
    expect(toPrintToPdfRangeString(ok('1,3-4'))).toBe('1,3-4');
  });
});
