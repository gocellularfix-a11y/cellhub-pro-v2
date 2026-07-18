// ============================================================
// Structured Query Executor — date-range resolution (I3-2).
//
// One typed resolver from ParsedDateRange to the canonical inclusive LOCAL
// day range. Reuses the SAME helpers Reports/Intelligence already use
// (normalizeLocalDayRange / localDayRangeForIntelRange semantics) — no UTC
// shifting, no re-derived day algorithms. The product default when no date is
// given is the EXISTING data-query default: last_30_days. Reference "now" is
// injectable for deterministic tests.
// ============================================================

import { normalizeLocalDayRange } from '@/utils/reportRange';
import type { ParsedDateRange } from '../language/types';
import { toLocalYMD, localDayRangeForIntelRange } from '../adapters/reportMoneyAdapter';
import type { ResolvedBusinessDateRange } from './types';

function ymdOf(d: Date): string { return toLocalYMD(d); }
function shiftDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** Resolve a parsed date range (or the product default). Returns null when an
 *  explicit custom range is invalid (missing/reversed) — invalid ranges never
 *  execute and are never silently swapped. */
export function resolveBusinessDateRange(
  parsed: ParsedDateRange | undefined,
  now: Date,
): ResolvedBusinessDateRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (!parsed) {
    // EXISTING product default (legacy detectDataQueryRange): last_30_days.
    const r = localDayRangeForIntelRange('last_30_days', now);
    return { range: r, labelKind: 'last_30_days', startYMD: ymdOf(r.start), endYMD: ymdOf(r.end), defaulted: true };
  }

  switch (parsed.kind) {
    case 'today':
    case 'yesterday':
    case 'this_week':
    case 'this_month': {
      const r = localDayRangeForIntelRange(parsed.kind, now);
      return { range: r, labelKind: parsed.kind, startYMD: ymdOf(r.start), endYMD: ymdOf(r.end), defaulted: false };
    }
    case 'last_week': {
      // Sunday-anchored previous week (mirror of the existing this_week anchor).
      const thisWeekStart = shiftDays(today, -today.getDay());
      const start = shiftDays(thisWeekStart, -7);
      const end = shiftDays(thisWeekStart, -1);
      const r = normalizeLocalDayRange(ymdOf(start), ymdOf(end));
      return { range: r, labelKind: 'last_week', startYMD: ymdOf(start), endYMD: ymdOf(end), defaulted: false };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      const r = normalizeLocalDayRange(ymdOf(start), ymdOf(end));
      return { range: r, labelKind: 'last_month', startYMD: ymdOf(start), endYMD: ymdOf(end), defaulted: false };
    }
    case 'all_time': {
      const r = normalizeLocalDayRange('1970-01-01', ymdOf(today));
      return { range: r, labelKind: 'all_time', startYMD: '1970-01-01', endYMD: ymdOf(today), defaulted: false };
    }
    case 'custom': {
      if (!parsed.startDate || !parsed.endDate) return null;
      const r = normalizeLocalDayRange(parsed.startDate, parsed.endDate);
      if (!r.valid) return null;   // reversed/missing → never execute, never swap
      return { range: r, labelKind: 'custom', startYMD: parsed.startDate, endYMD: parsed.endDate, defaulted: false };
    }
    default:
      return null;
  }
}

/** The immediately preceding period with the SAME inclusive number of local
 *  days (today→yesterday; a 7-day week→the prior 7 days; …). */
export function derivePreviousPeriod(current: ResolvedBusinessDateRange): ResolvedBusinessDateRange {
  const start = new Date(`${current.startYMD}T00:00:00`);
  const end = new Date(`${current.endYMD}T00:00:00`);
  const lengthDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = shiftDays(start, -1);
  const prevStart = shiftDays(prevEnd, -(lengthDays - 1));
  const r = normalizeLocalDayRange(ymdOf(prevStart), ymdOf(prevEnd));
  return { range: r, labelKind: 'previous_period', startYMD: ymdOf(prevStart), endYMD: ymdOf(prevEnd), defaulted: false };
}
