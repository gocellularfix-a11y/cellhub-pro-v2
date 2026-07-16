// R-2.1.4-CLOSEOUT — LAN print-bridge contract tests.
// Locks the parity guarantee: a Secondary→Primary Custom Range job carries
// the FULL validated print contract and lands on the SAME printRun payload
// (and therefore the same canonical selected-page pipeline) as a direct
// Primary print. Invalid ranges are blocked/rejected — never stripped into
// an implicit "print all pages".
import { describe, it, expect } from 'vitest';
import {
  buildLanPrintJob, buildBridgedPrintRunPayload, sanitizeZeroBasedRanges, resolveBridgePrinter,
  buildPrinterInventory, buildLanPrintSubmit, buildPrintServerRunPayload,
} from './printBridge';
import { parsePageRanges } from '@/utils/pageRanges';
// @ts-expect-error — CJS main-process module without type declarations.
import printPages from '../../../electron/printPages.js';

const LETTER = { width: 215900, height: 279400 };
const R80MM = { width: 80000, height: 297000 };
const R4X6 = { width: 101600, height: 152400 };

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

describe('resolveBridgePrinter — Primary routes by media (never blind detectedPrinters[0])', () => {
  it('Letter report → the printer assigned to letter media', () => {
    const map = { 'Canon MF210 Series': 'letter', 'POS-80C': '80mm' };
    const r = resolveBridgePrinter(LETTER, map, ['POS-80C', 'Canon MF210 Series']);
    expect(r).toEqual({ ok: true, printer: 'Canon MF210 Series', media: 'letter' });
  });

  it('80mm receipt → the printer assigned to 80mm media', () => {
    const map = { 'Canon MF210 Series': 'letter', 'POS-80C': '80mm' };
    const r = resolveBridgePrinter(R80MM, map, ['Canon MF210 Series', 'POS-80C']);
    expect(r).toEqual({ ok: true, printer: 'POS-80C', media: '80mm' });
  });

  it('4x6 receipt → the printer assigned to 4x6 media', () => {
    const map = { 'ZebraZD410': '4x6', 'POS-80C': '80mm' };
    const r = resolveBridgePrinter(R4X6, map, ['POS-80C', 'ZebraZD410']);
    expect(r).toEqual({ ok: true, printer: 'ZebraZD410', media: '4x6' });
  });

  it('Letter report with NO letter assignment → REJECTED (never sent to a receipt/first printer)', () => {
    // detectedPrinters[0] is the receipt printer — must NOT be used for a report.
    const map = { 'POS-80C': '80mm' };
    const r = resolveBridgePrinter(LETTER, map, ['POS-80C', 'Canon MF210 Series']);
    expect(r).toEqual({ ok: false, media: 'letter', error: 'no_report_printer' });
  });

  it('Letter report with NO media map at all → REJECTED (no blind first-printer)', () => {
    const r = resolveBridgePrinter(LETTER, {}, ['POS-80C']);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_report_printer');
  });

  it('receipt media with no assignment → default printer fallback (existing receipt bridge preserved)', () => {
    const r = resolveBridgePrinter(R80MM, {}, ['POS-80C', 'Canon MF210 Series']);
    expect(r).toEqual({ ok: true, printer: 'POS-80C', media: '80mm', viaDefaultFallback: true });
  });

  it('receipt media with no assignment and no printers → clear error', () => {
    const r = resolveBridgePrinter(R80MM, {}, []);
    expect(r).toEqual({ ok: false, media: '80mm', error: 'no_receipt_printer' });
  });

  it('unclassifiable page size → rejected, never guessed', () => {
    // 150×160 mm matches no media bucket (not label ≤62, not sheet ≥200, etc.).
    const r = resolveBridgePrinter({ width: 150000, height: 160000 }, { 'X': 'letter' }, ['X']);
    expect(r).toEqual({ ok: false, media: 'unknown', error: 'unclassified_media' });
  });

  it('tolerates missing/garbage inputs without throwing', () => {
    expect(resolveBridgePrinter(undefined, undefined, undefined).ok).toBe(false);
    expect(resolveBridgePrinter(LETTER, null, null).error).toBe('no_report_printer');
  });
});

describe('bridged SALES REPORT crosses the LAN intact and routes to the report printer', () => {
  const reportJob = {
    receiptType: 'report',
    html: '<!DOCTYPE html><html><head><style>@page{size:letter}</style></head><body>Sales Report</body></html>',
    copies: 2,
    pageSize: LETTER,
    pageRanges: undefined as undefined | Array<{ from: number; to: number }>,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    scaleFactor: 100,
    landscape: false,
  };

  it('all print options survive Secondary→wire→Primary and route to the letter printer', () => {
    const built = buildLanPrintJob(reportJob);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wire = JSON.parse(JSON.stringify(built.job));
    // Primary resolves the printer by media (letter → configured report printer):
    const routed = resolveBridgePrinter(wire.pageSize, { 'Canon MF210 Series': 'letter', 'POS-80C': '80mm' }, ['POS-80C', 'Canon MF210 Series']);
    expect(routed).toMatchObject({ ok: true, printer: 'Canon MF210 Series' });
    const mapped = buildBridgedPrintRunPayload(wire, routed.printer!);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.payload).toMatchObject({
      html: reportJob.html,
      deviceName: 'Canon MF210 Series',
      copies: 2,
      pageSize: LETTER,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      scaleFactor: 100,
      landscape: false,
    });
    expect('pageRanges' in mapped.payload).toBe(false); // all pages
  });

  it('Current-page and Custom ranges survive the bridge (0-based, validated)', () => {
    for (const ranges of [[{ from: 0, to: 0 }], [{ from: 1, to: 1 }], [{ from: 0, to: 1 }]]) {
      const built = buildLanPrintJob({ ...reportJob, pageRanges: ranges });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const wire = JSON.parse(JSON.stringify(built.job));
      const mapped = buildBridgedPrintRunPayload(wire, 'Canon MF210 Series');
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) return;
      expect(mapped.payload.pageRanges).toEqual(ranges);
    }
  });

  it('an invalid report range is blocked on the Secondary before LAN send', () => {
    const bad = buildLanPrintJob({ ...reportJob, pageRanges: [{ from: 3, to: 1 }] });
    expect(bad).toEqual({ ok: false, error: 'bad_page_ranges' });
  });
});

// ── R-PRINT-SERVER-V1 — print-server contract ──

describe('buildPrinterInventory — Primary advertises its printers', () => {
  it('serializes name/displayName/default/offline/media for the wire', () => {
    const printers = [
      { name: 'Canon MF210 Series', displayName: 'Canon MF210', isDefault: false, status: 0 },
      { name: 'POS-80C', isDefault: true, status: 0 },
      { name: 'DYMO 450', displayName: 'DYMO LabelWriter 450', isDefault: false, status: 0x80 },
    ];
    const map = { 'Canon MF210 Series': 'letter', 'POS-80C': '80mm' };
    expect(buildPrinterInventory(printers, map)).toEqual([
      { name: 'Canon MF210 Series', displayName: 'Canon MF210', isDefault: false, offline: false, media: 'letter' },
      { name: 'POS-80C', displayName: 'POS-80C', isDefault: true, offline: false, media: '80mm' },
      { name: 'DYMO 450', displayName: 'DYMO LabelWriter 450', isDefault: false, offline: true, media: '' },
    ]);
  });

  it('tolerates garbage inputs', () => {
    expect(buildPrinterInventory(null, null)).toEqual([]);
    expect(buildPrinterInventory([{ name: '', isDefault: false, status: 0 }], {})).toEqual([]);
  });
});

describe('LAN_PRINT_SUBMIT — Secondary submits ONE complete job to an explicit printer', () => {
  const submit = {
    receiptType: 'report',
    documentType: 'report',
    html: '<h1>Sales Report</h1>',
    copies: 2,
    pageSize: LETTER,
    pageRanges: [{ from: 0, to: 1 }],
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    scaleFactor: 100,
    landscape: false,
    printerName: 'Canon MF210 Series',
    jobId: 'job-123',
  };

  it('the full contract survives Secondary→wire→Primary onto the canonical printRun payload', () => {
    const built = buildLanPrintSubmit(submit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wire = JSON.parse(JSON.stringify(built.job));
    const run = buildPrintServerRunPayload(wire, ['POS-80C', 'Canon MF210 Series']);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.jobId).toBe('job-123');
    expect(run.printerName).toBe('Canon MF210 Series');
    expect(run.documentType).toBe('report');
    expect(run.payload).toEqual({
      html: '<h1>Sales Report</h1>',
      deviceName: 'Canon MF210 Series',
      copies: 2,
      pageSize: LETTER,
      pageRanges: [{ from: 0, to: 1 }],
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      scaleFactor: 100,
      landscape: false,
    });
  });

  it('Secondary blocks a submit without an explicit printer or jobId', () => {
    expect(buildLanPrintSubmit({ ...submit, printerName: '' })).toEqual({ ok: false, error: 'no_printer_selected' });
    expect(buildLanPrintSubmit({ ...submit, jobId: '' })).toEqual({ ok: false, error: 'bad_job_id' });
  });

  it('Secondary blocks invalid ranges before the LAN (same rule as the receipt bridge)', () => {
    expect(buildLanPrintSubmit({ ...submit, pageRanges: [{ from: 2, to: 1 }] })).toEqual({ ok: false, error: 'bad_page_ranges' });
  });

  it('Primary REJECTS a job naming a printer it does not own (no arbitrary devices)', () => {
    const built = buildLanPrintSubmit(submit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const run = buildPrintServerRunPayload(JSON.parse(JSON.stringify(built.job)), ['POS-80C']);
    expect(run).toEqual({ ok: false, error: 'printer_not_found', jobId: 'job-123' });
  });

  it('Primary defensively rejects tampered payloads (ranges, missing html, missing jobId)', () => {
    expect(buildPrintServerRunPayload({ jobId: 'j', printerName: 'X', html: '<p>d</p>', pageRanges: [{ from: 3, to: 1 }] }, ['X']))
      .toEqual({ ok: false, error: 'bad_page_ranges', jobId: 'j' });
    expect(buildPrintServerRunPayload({ jobId: 'j', printerName: 'X', html: '' }, ['X']))
      .toEqual({ ok: false, error: 'bad_payload', jobId: 'j' });
    expect(buildPrintServerRunPayload({ printerName: 'X', html: '<p>d</p>' }, ['X']))
      .toEqual({ ok: false, error: 'bad_job_id' });
  });
});
