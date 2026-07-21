// ============================================================
// I6-0A — pure evidence measures over CANONICAL outputs.
//
// COUNTING/SCANNING ONLY. Nothing here computes, adjusts or reinterprets
// money: cost coverage sums already-canonical per-line cents into a ratio,
// activity scans read record dates, attribution counts customerId presence.
// All money math stays inside computeReportMoneyStats.
// ============================================================

import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import { toDateSafe } from '@/services/reports/computeReportMoneyStats';
import { isWithinLocalDayRange } from '@/utils/reportRange';
import type { LocalDayRange } from '@/utils/reportRange';
import type { Sale } from '@/store/types';
import { ymdLocal } from './analysisWindow';

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Revenue-weighted fraction of canonical POS lines carrying a recorded
 *  cost (> 0), from the period's perSaleEconomics. Null when the period has
 *  no positive-revenue lines (no coverage claim is possible). */
export function costCoverageOf(stats: ReportMoneyStats): number | null {
  let covered = 0;
  let total = 0;
  for (const sale of Object.values(stats.perSaleEconomics)) {
    for (const line of sale.lines) {
      if (line.revenueCents <= 0) continue;
      total += line.revenueCents;
      if (line.costCents > 0) covered += line.revenueCents;
    }
  }
  if (total <= 0) return null;
  return round3(covered / total);
}

export interface ActivityScan {
  earliestYMD: string | null;
  latestYMD: string | null;
}

/** Earliest/latest recorded sale dates in the (already store-scoped)
 *  snapshot — history/staleness signals, no inclusion-rule semantics. */
export function scanActivityDates(sales: Sale[]): ActivityScan {
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const s of sales) {
    const d = toDateSafe(s.createdAt);
    if (!d) continue;
    if (!earliest || d < earliest) earliest = d;
    if (!latest || d > latest) latest = d;
  }
  return {
    earliestYMD: earliest ? ymdLocal(earliest) : null,
    latestYMD: latest ? ymdLocal(latest) : null,
  };
}

/** Share of in-range sales structurally attributed to a customer
 *  (customerId present). Null when the range has no sales. */
export function customerAttributionShare(sales: Sale[], range: LocalDayRange): number | null {
  let inRange = 0;
  let attributed = 0;
  for (const s of sales) {
    if (!isWithinLocalDayRange(toDateSafe(s.createdAt), range)) continue;
    inRange++;
    if (String((s as { customerId?: string }).customerId || '').trim()) attributed++;
  }
  if (inRange === 0) return null;
  return round3(attributed / inRange);
}

/** Sales within a local-day range (scoping only — no inclusion rules). */
export function salesInRange(sales: Sale[], range: LocalDayRange): Sale[] {
  return sales.filter((s) => isWithinLocalDayRange(toDateSafe(s.createdAt), range));
}
