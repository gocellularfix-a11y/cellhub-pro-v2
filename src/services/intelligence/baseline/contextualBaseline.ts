// R-INTELLIGENCE-CONTEXTUAL-BASELINE-ENGINE-V1
// Computes store-aware operational baselines from historical sales data.
// Pure deterministic aggregation — no ML, no external calls, under 10ms.
//
// Architecture note: the ContextualBaseline shape includes fields designed
// to accommodate future seasonal/holiday/growth normalization. Those
// extensions are NOT implemented here — the fields serve as stable
// extension points for later rounds.

import type { Sale } from '@/store/types';
import type { ContextualBaseline } from '../types';

const DOW_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
] as const;

function saleTs(s: Sale): number {
  try {
    const ca = s.createdAt;
    const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
      ? (ca as { toDate: () => Date }).toDate()
      : new Date(ca as string | Date);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch { return 0; }
}

export function computeContextualBaseline(sales: Sale[]): ContextualBaseline {
  const now     = Date.now();
  const cutoff30 = now - 30 * 24 * 60 * 60 * 1000;
  const cutoff7  = now -  7 * 24 * 60 * 60 * 1000;

  const recent: Sale[] = [];
  for (const s of sales) {
    const t = saleTs(s);
    if (!t || t < cutoff30) continue;
    const status = String((s as { status?: string }).status || '').toLowerCase();
    if (status === 'voided') continue;
    recent.push(s);
  }

  const empty: ContextualBaseline = {
    dailyAverage: 0,
    weekdayAverage: Object.fromEntries(DOW_NAMES.map(d => [d, 0])),
    hourlyAverage: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, 0])),
    rolling7dAverage: 0,
    rolling30dAverage: 0,
    expectedRangeLow: 0,
    expectedRangeHigh: 0,
    volatilityScore: 0,
  };

  if (recent.length === 0) return empty;

  const dailyMap  = new Map<string, number>();
  const dowTotals: number[]     = new Array(7).fill(0);
  const dowDates:  Set<string>[] = Array.from({ length: 7 }, () => new Set());
  const hourlyTotals: number[]  = new Array(24).fill(0);

  for (const s of recent) {
    const t   = saleTs(s);
    const d   = new Date(t);
    const rev = (s as { total?: number }).total || 0;
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, (dailyMap.get(key) || 0) + rev);
    const dow = d.getDay();
    dowTotals[dow] += rev;
    dowDates[dow].add(key);
    hourlyTotals[d.getHours()] += rev;
  }

  const tradingDays      = dailyMap.size || 1;
  const totalRevenue30   = Array.from(dailyMap.values()).reduce((a, b) => a + b, 0);
  const dailyAverage     = totalRevenue30 / tradingDays;
  const rolling30dAverage = totalRevenue30 / 30;

  const totalRevenue7 = recent
    .filter(s => saleTs(s) >= cutoff7)
    .reduce((sum, s) => sum + ((s as { total?: number }).total || 0), 0);
  const rolling7dAverage = totalRevenue7 / 7;

  // Weekday averages: revenue / unique-date occurrences (not transaction count)
  const weekdayAverage: Record<string, number> = {};
  for (let d = 0; d < 7; d++) {
    const occ = dowDates[d].size;
    weekdayAverage[DOW_NAMES[d]] = occ > 0 ? dowTotals[d] / occ : 0;
  }

  // Hourly averages: 30d total / trading days = avg per active trading day
  const hourlyAverage: Record<number, number> = {};
  for (let h = 0; h < 24; h++) {
    hourlyAverage[h] = hourlyTotals[h] / tradingDays;
  }

  // Volatility: coefficient of variation (stddev / mean) of daily revenues
  const dailyValues = Array.from(dailyMap.values());
  let volatilityScore = 0;
  if (dailyValues.length >= 3 && dailyAverage > 0) {
    const variance = dailyValues.reduce((s, v) => s + (v - dailyAverage) ** 2, 0) / dailyValues.length;
    volatilityScore = Math.min(1, Math.sqrt(variance) / dailyAverage);
  }

  const stddev           = dailyAverage * volatilityScore;
  const expectedRangeLow  = Math.max(0, dailyAverage - stddev);
  const expectedRangeHigh = Math.min(dailyAverage * 2.5, dailyAverage + stddev);

  return {
    dailyAverage,
    weekdayAverage,
    hourlyAverage,
    rolling7dAverage,
    rolling30dAverage,
    expectedRangeLow,
    expectedRangeHigh,
    volatilityScore,
  };
}

export interface DeviationResult {
  isDeviation: boolean;
  pct: number;    // negative = below baseline
  severity: 'none' | 'medium' | 'high' | 'critical';
}

// Classify how far `actual` deviates from `baseline`.
// Thresholds: <10% → ignore, 10-20% → medium, 20-35% → high, >35% → critical.
// volatility (0-1) widens thresholds proportionally for high-variance stores.
export function isMeaningfulDeviation(
  actual: number,
  baseline: number,
  volatility = 0,
): DeviationResult {
  if (baseline <= 0) return { isDeviation: false, pct: 0, severity: 'none' };
  const pct = ((actual - baseline) / baseline) * 100;
  const abs = Math.abs(pct);
  const tol = volatility * 8; // extra tolerance for volatile stores (up to +8%)

  if (abs < 10 + tol) return { isDeviation: false, pct, severity: 'none' };
  if (abs < 20 + tol) return { isDeviation: true,  pct, severity: 'medium' };
  if (abs < 35 + tol) return { isDeviation: true,  pct, severity: 'high' };
  return                     { isDeviation: true,  pct, severity: 'critical' };
}

export function getExpectedRevenueRange(
  baseline: ContextualBaseline,
): { low: number; high: number } {
  return { low: baseline.expectedRangeLow, high: baseline.expectedRangeHigh };
}
