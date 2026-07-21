// ============================================================
// GSCAN-1 — pure scanner sequence classifier tests.
//
// Deterministic timestamps (no real timers): the tracker is a pure state
// machine, so every timing scenario is an explicit number.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  createScannerSequenceTracker,
  normalizeScannedCode,
  SCANNER_MIN_LENGTH,
  SCANNER_MAX_INTERKEY_MS,
  SCANNER_AUTOFLUSH_MS,
} from './scannerSequence';

/** Feed a whole string at a fixed inter-key gap; returns the next timestamp. */
function feed(tracker: ReturnType<typeof createScannerSequenceTracker>, text: string, startAt: number, gapMs: number): number {
  let t = startAt;
  for (const ch of text) {
    tracker.feedChar(ch, t);
    t += gapMs;
  }
  return t;
}

describe('GSCAN-1 — scanner sequence classification', () => {
  it('thresholds are centralized, named and sane', () => {
    expect(SCANNER_MIN_LENGTH).toBe(4);
    expect(SCANNER_MAX_INTERKEY_MS).toBe(80);
    expect(SCANNER_AUTOFLUSH_MS).toBe(200);
  });
  it('fast sequence terminated with fast Enter → scannerFast scan', () => {
    const tr = createScannerSequenceTracker();
    const t = feed(tr, '001234567890', 1000, 20);
    const flush = tr.flushEnter(t);
    expect(flush).toEqual({ code: '001234567890', scannerFast: true });
  });
  it('slow human typing then Enter → NOT scanner-fast (normal Enter flow keeps ownership)', () => {
    const tr = createScannerSequenceTracker();
    const t = feed(tr, '1234', 1000, 250);        // human speed — buffer resets each key
    const flush = tr.flushEnter(t);
    expect(flush).toBeNull();                      // buffer never accumulated 4 chars
  });
  it('fast burst but SLOW Enter → flush without scannerFast (human finished a search)', () => {
    const tr = createScannerSequenceTracker();
    const t = feed(tr, '99887766', 1000, 20);
    const flush = tr.flushEnter(t + 2000);         // thought about it, then Enter
    expect(flush).toEqual({ code: '99887766', scannerFast: false });
  });
  it('Enter with an empty/short buffer never scans', () => {
    const tr = createScannerSequenceTracker();
    expect(tr.flushEnter(1000)).toBeNull();
    feed(tr, '123', 2000, 10);                     // below SCANNER_MIN_LENGTH
    expect(tr.flushEnter(2030)).toBeNull();
  });
  it('a human-speed gap resets the buffer mid-sequence', () => {
    const tr = createScannerSequenceTracker();
    let t = feed(tr, '111', 1000, 20);
    t += 500;                                      // pause — typing, not a scan
    t = feed(tr, '2222', t, 20);
    const flush = tr.flushEnter(t);
    expect(flush!.code).toBe('2222');              // the pre-pause chars are gone
  });
  it('buffer clears after every flush — two consecutive scans work', () => {
    const tr = createScannerSequenceTracker();
    let t = feed(tr, 'AAAA1111', 1000, 15);
    expect(tr.flushEnter(t)!.code).toBe('AAAA1111');
    expect(tr.size()).toBe(0);
    t = feed(tr, 'BBBB2222', t + 3000, 15);
    expect(tr.flushEnter(t)!.code).toBe('BBBB2222');
  });
  it('timeout flush (scanner without Enter suffix) honors the last-gap contract', () => {
    const tr = createScannerSequenceTracker();
    feed(tr, '556677889900', 1000, 20);
    const flush = tr.flushTimeout();
    expect(flush).toEqual({ code: '556677889900', scannerFast: true });
    expect(tr.size()).toBe(0);                     // buffer cleaned after timeout
  });
  it('leading zeros preserved; code stays a string, never truncated', () => {
    const tr = createScannerSequenceTracker();
    const long = '00012345678901234567890123456789';   // 32 chars
    const t = feed(tr, long, 1000, 10);
    const flush = tr.flushEnter(t);
    expect(flush!.code).toBe(long);
    expect(flush!.code.startsWith('000')).toBe(true);
    expect(typeof flush!.code).toBe('string');
  });
  it('IMEI preserved exactly as string (15 digits)', () => {
    const tr = createScannerSequenceTracker();
    const imei = '354442067957713';
    const t = feed(tr, imei, 1000, 12);
    expect(tr.flushEnter(t)!.code).toBe(imei);
  });
  it('reset() clears everything (unmount safety)', () => {
    const tr = createScannerSequenceTracker();
    feed(tr, '12345678', 1000, 10);
    tr.reset();
    expect(tr.size()).toBe(0);
    expect(tr.flushEnter(1200)).toBeNull();
  });
});

describe('GSCAN-1 — normalization', () => {
  it('strips ASCII control characters and DEL', () => {
    expect(normalizeScannedCode('12\t34\r56\n7879')).toBe('1234567879');
  });
  it('trims accidental surrounding whitespace only', () => {
    expect(normalizeScannedCode('  001234567890  ')).toBe('001234567890');
  });
  it('preserves leading zeros and never coerces to number', () => {
    const v = normalizeScannedCode('001234567890');
    expect(v).toBe('001234567890');
    expect(typeof v).toBe('string');
  });
  it('no truncation of long EAN/SKU/serial strings', () => {
    const long = 'SER-000012345678901234567890';
    expect(normalizeScannedCode(long)).toBe(long);
  });
  it('interior spaces are preserved (only edges trimmed)', () => {
    expect(normalizeScannedCode(' AB 12 ')).toBe('AB 12');
  });
});
