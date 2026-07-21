// ============================================================
// I6-0 — resolved analysis windows (pure, deterministic).
//
// current  = the 7 FULL local days ending YESTERDAY (today is partial and
//            would make the same query non-deterministic through the day);
// baseline = the previous 7 local days, NON-OVERLAPPING (closes the known
//            I2B directional finding where trend windows shared one day).
// ============================================================

import { normalizeLocalDayRange } from '@/utils/reportRange';
import type { AnalysisWindow, AnalysisWindowLabel, ResolvedAnalysisWindows } from './types';

export const ANALYSIS_WINDOW_DAYS = 7;

function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftDays(d: Date, days: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}
function window(label: AnalysisWindowLabel, start: Date, end: Date): AnalysisWindow {
  const startYMD = ymdLocal(start);
  const endYMD = ymdLocal(end);
  return {
    label, startYMD, endYMD,
    range: normalizeLocalDayRange(startYMD, endYMD),
    dayCount: ANALYSIS_WINDOW_DAYS,
  };
}

/** Pure resolution from an injected reference date — same input, same
 *  windows, forever. */
export function resolveAnalysisWindows(referenceDate: Date): ResolvedAnalysisWindows {
  const currentEnd = shiftDays(referenceDate, -1);                          // yesterday
  const currentStart = shiftDays(currentEnd, -(ANALYSIS_WINDOW_DAYS - 1));  // 7 full days
  const baselineEnd = shiftDays(currentStart, -1);                          // no overlap
  const baselineStart = shiftDays(baselineEnd, -(ANALYSIS_WINDOW_DAYS - 1));
  return {
    referenceYMD: ymdLocal(referenceDate),
    current: window('current_7_full_days', currentStart, currentEnd),
    baseline: window('baseline_previous_7_days', baselineStart, baselineEnd),
  };
}
