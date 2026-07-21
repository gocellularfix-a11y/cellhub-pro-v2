// ============================================================
// I6-0A — resolved analysis windows (pure, deterministic, SHARED).
//
// Detectors NEVER do date math themselves — every window resolves here.
//
// 7v7: current = the 7 FULL local days ending YESTERDAY (today is partial
//      and would make the same query non-deterministic through the day);
//      baseline = the previous 7 local days, NON-OVERLAPPING (closes the
//      known I2B directional finding where trend windows shared one day).
// 30:  the 30 FULL local days ending YESTERDAY (carrier activity window).
// ============================================================

import { normalizeLocalDayRange } from '@/utils/reportRange';
import type { AnalysisWindow, AnalysisWindowLabel, ResolvedAnalysisWindows } from './types';
import { CARRIER_WINDOW_DAYS } from './thresholds';

export const ANALYSIS_WINDOW_DAYS = 7;

export function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftDays(d: Date, days: number): Date {
  // Local-calendar arithmetic (setDate) — DST transitions never skew a day.
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}
function window(label: AnalysisWindowLabel, start: Date, end: Date, dayCount: number): AnalysisWindow {
  const startYMD = ymdLocal(start);
  const endYMD = ymdLocal(end);
  return { label, startYMD, endYMD, range: normalizeLocalDayRange(startYMD, endYMD), dayCount };
}

/** The `days` FULL local days ending YESTERDAY relative to `referenceDate`.
 *  Pure — same input, same window, forever. */
export function resolveTrailingWindow(referenceDate: Date, days: number, label: AnalysisWindowLabel): AnalysisWindow {
  const end = shiftDays(referenceDate, -1);          // yesterday, never today
  const start = shiftDays(end, -(days - 1));
  return window(label, start, end, days);
}

/** Pure 7v7 resolution from an injected reference date. */
export function resolveAnalysisWindows(referenceDate: Date): ResolvedAnalysisWindows {
  const current = resolveTrailingWindow(referenceDate, ANALYSIS_WINDOW_DAYS, 'current_7_full_days');
  const baselineEnd = shiftDays(referenceDate, -(ANALYSIS_WINDOW_DAYS + 1)); // day before current start
  const baselineStart = shiftDays(baselineEnd, -(ANALYSIS_WINDOW_DAYS - 1));
  return {
    referenceYMD: ymdLocal(referenceDate),
    current,
    baseline: window('baseline_previous_7_days', baselineStart, baselineEnd, ANALYSIS_WINDOW_DAYS),
  };
}

/** The carrier-activity window: 30 full local days ending yesterday. */
export function resolveCarrierWindow(referenceDate: Date): AnalysisWindow {
  return resolveTrailingWindow(referenceDate, CARRIER_WINDOW_DAYS, 'current_30_full_days');
}
