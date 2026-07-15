// R-2.1.4-CLOSEOUT — LAN print-bridge contract tests.
// Locks the parity guarantee: a Secondary→Primary Custom Range job carries
// the FULL validated print contract and lands on the SAME printRun payload
// (and therefore the same canonical selected-page pipeline) as a direct
// Primary print. Invalid ranges are blocked/rejected — never stripped into
// an implicit "print all pages".
import { describe, it, expect } from 'vitest';
import { buildLanPrintJob, buildBridgedPrintRunPayload, sanitizeZeroBasedRanges } from './printBridge';
import { parsePageRanges } from '@/utils/pageRanges';
// @ts-expect-error — CJS main-process module without type declarations.
import printPages from '../../../electron/printPages.js';

const LETTER = { width: 215900, height: 279400 };

/** What the modal sends for a validated custom input (1-based → 0-based). */
function modalRanges(input: string) {
  const parsed = parsePageRanges(input);
  if (!parsed.ok) throw new Error('fixture range must parse');
  return parsed.ranges.map((r) => ({ from: r.from - 1, to: r.to - 1 }));
}

function modalJob(input?: string) {
  return {
    receiptType: 'receipt',
    html: '<h1>DOC</h1>',
    copies: 2,
    pageSize: LETTER,
    pageRanges: input === undefined ? undefined : modalRanges(input),
    margins: { top: 0.25, bottom: 0.25, left: 0.25, right: 0.25 },
    scaleFactor: 80,
    landscape: false,
  };
}

describe('LAN parity — direct vs bridged selected pages', () => {
  for (const input of ['1', '2-3', '1,3-4']) {
    it(`custom "${input}" survives Secondary→wire→Primary identical to a direct print`, () => {
      const direct = modalRanges(input);
      const built = buildLanPrintJob(modalJob(input));
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      // Wire crossing (socket JSON):
      const wire = JSON.parse(JSON.stringify({ print: { ...built.job, printJobId: 'x', timestamp: 1 } }));
      const mapped = buildBridgedPrintRunPayload(wire.print, 'POS-80C');
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) return;
      // Identical 0-based ranges reach printRun on both paths:
      expect(mapped.payload.pageRanges).toEqual(direct);
      // …and normalize to identical 1-based selections in the main pipeline:
      const directNorm = printPages.normalizeZeroBasedRanges(direct);
      const bridgedNorm = printPages.normalizeZeroBasedRanges(mapped.payload.pageRanges);
      expect(bridgedNorm).toEqual(directNorm);
      expect(printPages.countSelectedPages(bridgedNorm)).toBe(printPages.countSelectedPages(directNorm));
    });
  }

  it('every print option survives LAN serialization (size, margins, scale, landscape, copies)', () => {
    const built = buildLanPrintJob(modalJob('2-3'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wire = JSON.parse(JSON.stringify(built.job));
    const mapped = buildBridgedPrintRunPayload(wire, 'Canon MF210 Series');
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.payload).toEqual({
      html: '<h1>DOC</h1>',
      deviceName: 'Canon MF210 Series',
      copies: 2,
      pageSize: LETTER,
      pageRanges: [{ from: 1, to: 2 }],
      margins: { top: 0.25, bottom: 0.25, left: 0.25, right: 0.25 },
      scaleFactor: 80,
      landscape: false,
    });
  });

  it('all-pages behavior is unchanged (no pageRanges key at all)', () => {
    const built = buildLanPrintJob(modalJob(undefined));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect('pageRanges' in built.job).toBe(false);
    const mapped = buildBridgedPrintRunPayload(JSON.parse(JSON.stringify(built.job)), 'POS-80C');
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect('pageRanges' in mapped.payload).toBe(false);
  });
});

describe('LAN parity — invalid and hostile inputs are rejected, never printed in full', () => {
  it('invalid ranges are blocked on the Secondary before forwarding', () => {
    const bad = buildLanPrintJob({ ...modalJob(), pageRanges: [{ from: 2, to: 1 }] });
    expect(bad).toEqual({ ok: false, error: 'bad_page_ranges' });
    const negative = buildLanPrintJob({ ...modalJob(), pageRanges: [{ from: -1, to: 0 }] });
    expect(negative).toEqual({ ok: false, error: 'bad_page_ranges' });
  });

  it('the Primary defensively rejects tampered/malformed received ranges (no strip-and-print-all)', () => {
    for (const hostile of [
      [{ from: 'x', to: 1 }],
      [{ from: 0.5, to: 1 }],
      [{ from: 3, to: 1 }],
      [],
      'not-an-array',
    ]) {
      const mapped = buildBridgedPrintRunPayload({ html: '<p>doc</p>', copies: 1, pageRanges: hostile }, 'POS-80C');
      expect(mapped).toEqual({ ok: false, error: 'bad_page_ranges' });
    }
  });

  it('out-of-bounds bridged ranges are rejected by the same main-process bounds check as direct prints', () => {
    const built = buildLanPrintJob(modalJob('9'));
    expect(built.ok).toBe(true); // shape-valid — bounds are a document property
    if (!built.ok) return;
    const mapped = buildBridgedPrintRunPayload(JSON.parse(JSON.stringify(built.job)), 'POS-80C');
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const norm = printPages.normalizeZeroBasedRanges(mapped.payload.pageRanges);
    expect(printPages.pagesBeyondCount(norm, 4)).toEqual([9]); // doc has 4 pages → rejected upstream
  });

  it('sanitizeZeroBasedRanges caps and validates strictly', () => {
    expect(sanitizeZeroBasedRanges([{ from: 0, to: 0 }])).toEqual([{ from: 0, to: 0 }]);
    expect(sanitizeZeroBasedRanges(null)).toBeNull();
    expect(sanitizeZeroBasedRanges([])).toBeNull();
    expect(sanitizeZeroBasedRanges(Array.from({ length: 51 }, (_, i) => ({ from: i, to: i })))).toBeNull();
  });

  it('missing printer on the Primary fails cleanly', () => {
    const mapped = buildBridgedPrintRunPayload({ html: '<p>doc</p>', copies: 1 }, '');
    expect(mapped).toEqual({ ok: false, error: 'no_printer' });
  });
});
