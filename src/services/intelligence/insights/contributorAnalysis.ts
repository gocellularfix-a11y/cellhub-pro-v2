// ============================================================
// Business Analyst — top contributors (I3-3 Part 5).
//
// Decomposes a metric's period-over-period change into EXACT canonical
// groupings only: category rows (revenue/cost/profit — canonical
// categoriesByRevenue) and payment-provider rows (total/profit — canonical
// phonePaymentsByProvider). No allocation, no estimation: a contributor
// exists only because two canonical row sets subtract. Metrics without an
// exact grouping return null — the explanation layer simply omits the
// contributor lines (never fabricates a reason).
// ============================================================

import type { BusinessMetric } from '../language/types';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import { derivePreviousPeriod } from '../query/resolveBusinessDateRange';
import type { ContributorAnalysis, ContributorDelta } from './types';

type RowMap = Map<string, number>;

function categoryRows(stats: ReportMoneyStats, metric: BusinessMetric): RowMap | null {
  const pick = (r: { revenueCents: number; costCents: number; profitCents: number }): number | null => {
    if (metric === 'gross_sales') return r.revenueCents;
    if (metric === 'cost') return r.costCents;
    if (metric === 'profit') return r.profitCents;
    return null;
  };
  const map: RowMap = new Map();
  for (const row of stats.categoriesByRevenue) {
    const v = pick(row);
    if (v === null) return null;
    map.set(row.name, v);
  }
  return map;
}

function providerRows(stats: ReportMoneyStats, metric: BusinessMetric): RowMap | null {
  const map: RowMap = new Map();
  for (const [name, b] of Object.entries(stats.phonePaymentsByProvider)) {
    if (metric === 'gross_sales') map.set(name, b.totalCents);
    else if (metric === 'profit') map.set(name, b.profitCents);
    else return null;
  }
  return map;
}

function deltas(dimension: ContributorDelta['dimension'], current: RowMap, previous: RowMap): ContributorDelta[] {
  const labels = new Set([...current.keys(), ...previous.keys()]);
  const out: ContributorDelta[] = [];
  for (const label of labels) {
    const cur = current.get(label) ?? 0;
    const prev = previous.get(label) ?? 0;
    if (cur === 0 && prev === 0) continue;
    out.push({ label, dimension, currentCents: cur, previousCents: prev, deltaCents: cur - prev });
  }
  return out;
}

/** Exact contributor decomposition for gross_sales / profit / cost. Category
 *  rows are the primary dimension (they cover the whole gross-activity
 *  population); provider rows add phone-payment detail. Deterministic order:
 *  |delta| desc, then label asc. */
export function computeContributors(
  ctx: StructuredQueryContext,
  metric: BusinessMetric,
  range: ResolvedBusinessDateRange,
): ContributorAnalysis | null {
  if (metric !== 'gross_sales' && metric !== 'profit' && metric !== 'cost') return null;

  const previousRange = derivePreviousPeriod(range);
  const current = ctx.computeForRange(range.range);
  const previous = ctx.computeForRange(previousRange.range);

  const curCat = categoryRows(current, metric);
  const prevCat = categoryRows(previous, metric);
  if (!curCat || !prevCat) return null;

  const all: ContributorDelta[] = deltas('category', curCat, prevCat);
  // Provider detail (only where the canonical rows expose the metric).
  const curProv = providerRows(current, metric);
  const prevProv = providerRows(previous, metric);
  if (curProv && prevProv) all.push(...deltas('payment_provider', curProv, prevProv));

  const byMagnitude = (a: ContributorDelta, b: ContributorDelta) =>
    Math.abs(b.deltaCents) - Math.abs(a.deltaCents) || a.label.localeCompare(b.label);
  return {
    metric,
    positive: all.filter((d) => d.deltaCents > 0).sort(byMagnitude),
    negative: all.filter((d) => d.deltaCents < 0).sort(byMagnitude),
  };
}
