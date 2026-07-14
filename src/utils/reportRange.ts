// ============================================================
// R-2.1.4-REPORT-RANGE-CONTRACT-V1
// Canonical local-day date-range normalization for reports/printing.
//
// Contract:
//   - Input: 'YYYY-MM-DD' strings from <input type="date"> (local store days).
//   - Start = local 00:00:00.000 of startYMD; End = local 23:59:59.999 of
//     endYMD (inclusive). Built via `new Date('YYYY-MM-DDTHH:mm:ss')` which
//     the ECMAScript spec parses as LOCAL time (date-with-time form) — the
//     selected store days never shift into the previous/following UTC day.
//   - valid === false when either date is missing/unparseable or end < start.
//     Consumers must block printing on invalid ranges (visible error, never
//     a silent empty print).
// ============================================================

export interface LocalDayRange {
  start: Date;
  end: Date;
  valid: boolean;
  /** Why valid === false: 'missing' | 'reversed' | null when valid. */
  invalidReason: 'missing' | 'reversed' | null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeLocalDayRange(startYMD: string, endYMD: string): LocalDayRange {
  const startOk = YMD_RE.test(String(startYMD || ''));
  const endOk = YMD_RE.test(String(endYMD || ''));
  const start = startOk ? new Date(`${startYMD}T00:00:00`) : new Date(NaN);
  const end = endOk ? new Date(`${endYMD}T23:59:59.999`) : new Date(NaN);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { start, end, valid: false, invalidReason: 'missing' };
  }
  if (start.getTime() > end.getTime()) {
    return { start, end, valid: false, invalidReason: 'reversed' };
  }
  return { start, end, valid: true, invalidReason: null };
}

/** Inclusive membership test against a normalized local-day range. */
export function isWithinLocalDayRange(d: Date | null | undefined, range: Pick<LocalDayRange, 'start' | 'end' | 'valid'>): boolean {
  if (!d || !range.valid) return false;
  return d >= range.start && d <= range.end;
}
