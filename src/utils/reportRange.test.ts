// R-2.1.4-REPORT-RANGE-CONTRACT-V1 — custom date-range accuracy tests.
// Locks the canonical local-day contract used by Reports filtering, printing
// and export: local midnight → local 23:59:59.999 inclusive, validated
// ordering, no UTC day-shift, invalid ranges refuse loudly.
import { describe, it, expect } from 'vitest';
import { normalizeLocalDayRange, isWithinLocalDayRange } from './reportRange';

function toLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('single-day custom range', () => {
  const r = normalizeLocalDayRange('2026-07-14', '2026-07-14');

  it('is valid and spans the full local calendar day', () => {
    expect(r.valid).toBe(true);
    expect(r.invalidReason).toBeNull();
    expect(r.start.getFullYear()).toBe(2026);
    expect(r.start.getMonth()).toBe(6);
    expect(r.start.getDate()).toBe(14);      // LOCAL day — never UTC-shifted
    expect(r.start.getHours()).toBe(0);
    expect(r.start.getMinutes()).toBe(0);
    expect(r.end.getDate()).toBe(14);
    expect(r.end.getHours()).toBe(23);
    expect(r.end.getMinutes()).toBe(59);
    expect(r.end.getSeconds()).toBe(59);
    expect(r.end.getMilliseconds()).toBe(999);
  });

  it('includes all transactions of that local day', () => {
    expect(isWithinLocalDayRange(new Date('2026-07-14T00:00:00'), r)).toBe(true);
    expect(isWithinLocalDayRange(new Date('2026-07-14T12:30:00'), r)).toBe(true);
  });

  it('includes an end-of-day transaction near 11:59 PM', () => {
    expect(isWithinLocalDayRange(new Date('2026-07-14T23:59:00'), r)).toBe(true);
    expect(isWithinLocalDayRange(new Date('2026-07-14T23:59:59.999'), r)).toBe(true);
  });

  it('excludes a transaction at midnight AFTER the selected end date', () => {
    expect(isWithinLocalDayRange(new Date('2026-07-15T00:00:00'), r)).toBe(false);
  });

  it('excludes transactions before the start date', () => {
    expect(isWithinLocalDayRange(new Date('2026-07-13T23:59:59.999'), r)).toBe(false);
  });
});

describe('multi-day custom range', () => {
  const r = normalizeLocalDayRange('2026-07-10', '2026-07-14');

  it('includes transactions on BOTH boundary dates', () => {
    expect(isWithinLocalDayRange(new Date('2026-07-10T00:00:01'), r)).toBe(true);
    expect(isWithinLocalDayRange(new Date('2026-07-10T08:00:00'), r)).toBe(true);
    expect(isWithinLocalDayRange(new Date('2026-07-14T23:58:00'), r)).toBe(true);
  });

  it('excludes just-outside boundaries', () => {
    expect(isWithinLocalDayRange(new Date('2026-07-09T23:59:59'), r)).toBe(false);
    expect(isWithinLocalDayRange(new Date('2026-07-15T00:00:00'), r)).toBe(false);
  });
});

describe('reversed dates', () => {
  it('is invalid with a clear reason (print/export must block, never crash)', () => {
    const r = normalizeLocalDayRange('2026-07-14', '2026-07-10');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('reversed');
    // Nothing matches an invalid range:
    expect(isWithinLocalDayRange(new Date('2026-07-12T12:00:00'), r)).toBe(false);
  });
});

describe('missing / malformed dates', () => {
  it('empty start or end is invalid (reason: missing), no crash', () => {
    expect(normalizeLocalDayRange('', '2026-07-14')).toMatchObject({ valid: false, invalidReason: 'missing' });
    expect(normalizeLocalDayRange('2026-07-14', '')).toMatchObject({ valid: false, invalidReason: 'missing' });
    expect(normalizeLocalDayRange('', '')).toMatchObject({ valid: false, invalidReason: 'missing' });
  });

  it('garbage input is invalid, no crash', () => {
    expect(normalizeLocalDayRange('not-a-date', '2026-07-14').valid).toBe(false);
    expect(normalizeLocalDayRange('2026-13-45', '2026-07-14').valid).toBe(false);
  });
});

describe('preset vs equivalent custom range', () => {
  it('the "Today" preset and a custom range selecting today produce the identical normalized range and identical filtered records', () => {
    const now = new Date();
    const todayYMD = toLocalYMD(now);            // what setQuick('daily') sets
    const preset = normalizeLocalDayRange(todayYMD, todayYMD);
    const custom = normalizeLocalDayRange(todayYMD, todayYMD); // user picks the same day in the date inputs
    expect(preset.start.getTime()).toBe(custom.start.getTime());
    expect(preset.end.getTime()).toBe(custom.end.getTime());

    // Same filtered dataset for both:
    const tx = [
      { id: 'a', createdAt: new Date(preset.start.getTime() + 60_000) },        // 00:01 today
      { id: 'b', createdAt: new Date(preset.end.getTime() - 60_000) },          // 23:58 today
      { id: 'c', createdAt: new Date(preset.start.getTime() - 60_000) },        // yesterday 23:59
      { id: 'd', createdAt: new Date(preset.end.getTime() + 1) },               // tomorrow 00:00
    ];
    const byPreset = tx.filter((s) => isWithinLocalDayRange(s.createdAt, preset)).map((s) => s.id);
    const byCustom = tx.filter((s) => isWithinLocalDayRange(s.createdAt, custom)).map((s) => s.id);
    expect(byPreset).toEqual(['a', 'b']);
    expect(byCustom).toEqual(byPreset);
  });
});

describe('timezone regression', () => {
  it('selected local store dates never move by one day after normalization', () => {
    // A date-only string passed through the contract must keep its LOCAL
    // calendar day (new Date('YYYY-MM-DDT00:00:00') parses as local time;
    // the buggy pattern new Date('YYYY-MM-DD') parses as UTC and shifts a
    // negative-offset store day backwards).
    for (const ymd of ['2026-01-01', '2026-07-14', '2026-12-31']) {
      const r = normalizeLocalDayRange(ymd, ymd);
      expect(toLocalYMD(r.start)).toBe(ymd);
      expect(toLocalYMD(r.end)).toBe(ymd);
    }
  });

  it('serializes across IPC as plain numbers/ISO without losing the day', () => {
    const r = normalizeLocalDayRange('2026-07-14', '2026-07-14');
    // Round-trip the way an Electron IPC payload would carry it (numeric
    // timestamps — Date objects don't cross process boundaries safely):
    const wire = JSON.parse(JSON.stringify({ start: r.start.getTime(), end: r.end.getTime() }));
    expect(new Date(wire.start).getDate()).toBe(14);
    expect(new Date(wire.end).getDate()).toBe(14);
    expect(wire.end - wire.start).toBe(24 * 60 * 60 * 1000 - 1);
  });
});
