// ============================================================
// R-PRINT-MEDIA-GUARD-V1 — printer media guard tests
// Covers the round's validation matrix:
//   label → label printer          OK (no warning)
//   label → 4×6 printer            warning (or reroute if a label printer exists)
//   receipt → label printer        warning
//   credential → label printer     warning
//   4×6 → receipt (80mm) printer   warning
// Plus classification buckets and fail-open behavior.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  classifyMediaFromMicrons,
  checkPrintMediaJob,
  type PrinterMediaMap,
} from './printMediaGuard';

// Exact microns the real print paths send (usePrint PAGE_SIZE_MICRONS /
// PrintPreviewModal PAGE_SIZES / Label Studio mm×1000).
const MICRONS = {
  dymoLabel: { width: 57150, height: 31750 },
  studioLabel89x36: { width: 89000, height: 36000 },
  receipt80mm: { width: 80000, height: 297000 },
  fourBySix: { width: 101600, height: 152400 },
  cr80Portrait: { width: 54000, height: 85600 },
  letter: { width: 215900, height: 279400 },
  a4: { width: 210000, height: 297000 },
};

describe('classifyMediaFromMicrons', () => {
  it('classifies each media family from the exact microns the app sends', () => {
    expect(classifyMediaFromMicrons(MICRONS.dymoLabel)).toBe('label');
    expect(classifyMediaFromMicrons(MICRONS.studioLabel89x36)).toBe('label');
    expect(classifyMediaFromMicrons(MICRONS.receipt80mm)).toBe('80mm');
    expect(classifyMediaFromMicrons(MICRONS.fourBySix)).toBe('4x6');
    expect(classifyMediaFromMicrons(MICRONS.cr80Portrait)).toBe('cr80');
    expect(classifyMediaFromMicrons(MICRONS.letter)).toBe('letter');
    expect(classifyMediaFromMicrons(MICRONS.a4)).toBe('letter');
  });

  it('is orientation-agnostic (landscape-swapped dimensions)', () => {
    expect(classifyMediaFromMicrons({ width: 85600, height: 54000 })).toBe('cr80');
    expect(classifyMediaFromMicrons({ width: 152400, height: 101600 })).toBe('4x6');
    expect(classifyMediaFromMicrons({ width: 31750, height: 57150 })).toBe('label');
  });

  it('returns unknown for missing or odd sizes', () => {
    expect(classifyMediaFromMicrons(null)).toBe('unknown');
    expect(classifyMediaFromMicrons({ width: 0, height: 0 })).toBe('unknown');
    expect(classifyMediaFromMicrons({ width: 150000, height: 190000 })).toBe('unknown');
  });
});

describe('checkPrintMediaJob — validation matrix', () => {
  const MAP: PrinterMediaMap = {
    'EPSON TM-T20III': '80mm',
    'Rollo 4x6': '4x6',
    'DYMO LabelWriter': 'label',
  };
  const MAP_NO_LABEL: PrinterMediaMap = {
    'EPSON TM-T20III': '80mm',
    'Rollo 4x6': '4x6',
  };

  it('label → label printer: ok', () => {
    expect(checkPrintMediaJob(MICRONS.dymoLabel, 'DYMO LabelWriter', MAP)).toEqual({ action: 'ok' });
  });

  it('label → 4x6 printer with NO dedicated label printer: warning', () => {
    const v = checkPrintMediaJob(MICRONS.dymoLabel, 'Rollo 4x6', MAP_NO_LABEL);
    expect(v.action).toBe('warn');
    if (v.action === 'warn') {
      expect(v.docMedia).toBe('label');
      expect(v.printerMedia).toBe('4x6');
    }
  });

  it('label → 4x6 printer with a dedicated label printer: auto-reroute (smart mapping)', () => {
    const v = checkPrintMediaJob(MICRONS.dymoLabel, 'Rollo 4x6', MAP);
    expect(v.action).toBe('reroute');
    if (v.action === 'reroute') expect(v.to).toBe('DYMO LabelWriter');
  });

  it('receipt (80mm) → label printer: warning (never rerouted)', () => {
    const v = checkPrintMediaJob(MICRONS.receipt80mm, 'DYMO LabelWriter', MAP);
    expect(v.action).toBe('warn');
    if (v.action === 'warn') {
      expect(v.docMedia).toBe('80mm');
      expect(v.printerMedia).toBe('label');
    }
  });

  it('credential (cr80) → label printer: warning', () => {
    const v = checkPrintMediaJob(MICRONS.cr80Portrait, 'DYMO LabelWriter', MAP);
    expect(v.action).toBe('warn');
    if (v.action === 'warn') expect(v.docMedia).toBe('cr80');
  });

  it('4x6 → receipt (80mm) printer: warning', () => {
    const v = checkPrintMediaJob(MICRONS.fourBySix, 'EPSON TM-T20III', MAP);
    expect(v.action).toBe('warn');
    if (v.action === 'warn') {
      expect(v.docMedia).toBe('4x6');
      expect(v.printerMedia).toBe('80mm');
    }
  });

  it('matching media never warns', () => {
    expect(checkPrintMediaJob(MICRONS.receipt80mm, 'EPSON TM-T20III', MAP)).toEqual({ action: 'ok' });
    expect(checkPrintMediaJob(MICRONS.fourBySix, 'Rollo 4x6', MAP)).toEqual({ action: 'ok' });
  });

  it('FAIL-OPEN: unconfigured printer or unknown job media → ok (zero regression)', () => {
    expect(checkPrintMediaJob(MICRONS.dymoLabel, 'Unknown Printer', MAP)).toEqual({ action: 'ok' });
    expect(checkPrintMediaJob(MICRONS.dymoLabel, 'Some Printer', {})).toEqual({ action: 'ok' });
    expect(checkPrintMediaJob(null, 'DYMO LabelWriter', MAP)).toEqual({ action: 'ok' });
    expect(checkPrintMediaJob(MICRONS.dymoLabel, '', MAP)).toEqual({ action: 'ok' });
  });

  it('reroute never targets the same (mismatched) printer', () => {
    const selfMap: PrinterMediaMap = { 'Rollo 4x6': '4x6' };
    const v = checkPrintMediaJob(MICRONS.dymoLabel, 'Rollo 4x6', selfMap);
    expect(v.action).toBe('warn');
  });
});
