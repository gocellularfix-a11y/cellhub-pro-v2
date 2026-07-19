// ============================================================
// Business Analyst — carrier analysis (I3-3 Part 9).
//
// Fastest growing / declining / highest profit / revenue / transactions —
// EXACT only (same I3-2 rule): any carrier-impure sale in the snapshot →
// a single refusal finding, no per-carrier numbers. Money via canonical
// scoped projections over pure single-carrier sales.
// ============================================================

import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import { derivePreviousPeriod } from '../query/resolveBusinessDateRange';
import {
  scopeSalesByCarrier, discoverCarriers, countCarrierImpureSales, snapshotWithSales,
} from '../query/scopeBusinessQueryData';
import type { InsightFinding } from './types';

const rangeOf = (r: ResolvedBusinessDateRange) => ({ startYMD: r.startYMD, endYMD: r.endYMD });

interface CarrierRow {
  carrier: string;
  revenueCents: number;
  profitCents: number;
  txCount: number;
  previousRevenueCents: number;
  revenueDeltaCents: number;
}

export function analyzeCarriers(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange): InsightFinding[] {
  // EXACTNESS GUARD (Part 9: "exact only").
  const impure = countCarrierImpureSales(ctx.snapshot.sales || []);
  if (impure > 0) {
    return [{
      id: 'carrier_attribution_mixed:range', kind: 'carrier_attribution_mixed',
      severity: 'information', confidence: 1, source: 'canonical_report_money',
      relatedMetrics: ['gross_sales', 'profit'], dateRange: rangeOf(range), magnitude: impure,
      data: { mixedSales: impure },
    }];
  }

  const prevRange = derivePreviousPeriod(range);
  const rows: CarrierRow[] = [];
  for (const carrier of discoverCarriers(ctx.snapshot.sales || [])) {
    const scoped = snapshotWithSales(ctx.snapshot, scopeSalesByCarrier(ctx.snapshot.sales || [], carrier).sales);
    const cur = ctx.computeForScopedSnapshot(scoped, range.range);
    const prev = ctx.computeForScopedSnapshot(scoped, prevRange.range);
    if (cur.grossSalesCents === 0 && prev.grossSalesCents === 0) continue;
    rows.push({
      carrier,
      revenueCents: cur.grossSalesCents,
      profitCents: cur.totalProfitCents,
      txCount: cur.txCount,
      previousRevenueCents: prev.grossSalesCents,
      revenueDeltaCents: cur.grossSalesCents - prev.grossSalesCents,
    });
  }
  if (rows.length === 0) return [];

  const findings: InsightFinding[] = [];
  const push = (kind: InsightFinding['kind'], row: CarrierRow, value: number, metrics: InsightFinding['relatedMetrics'], severity: InsightFinding['severity'] = 'positive') => {
    findings.push({
      id: `${kind}:${row.carrier.toLowerCase()}`, kind, severity, confidence: 1,
      source: 'canonical_report_money', relatedMetrics: metrics, dateRange: rangeOf(range),
      magnitude: Math.abs(value), data: { carrier: row.carrier, value, previousRevenueCents: row.previousRevenueCents },
    });
  };
  const top = <K extends keyof CarrierRow>(key: K) =>
    [...rows].sort((a, b) => (b[key] as number) - (a[key] as number) || a.carrier.localeCompare(b.carrier))[0];

  const byRevenue = top('revenueCents');
  if (byRevenue.revenueCents > 0) push('carrier_highest_revenue', byRevenue, byRevenue.revenueCents, ['gross_sales']);
  const byProfit = top('profitCents');
  if (byProfit.profitCents > 0) push('carrier_highest_profit', byProfit, byProfit.profitCents, ['profit']);
  const byTx = top('txCount');
  if (byTx.txCount > 0) push('carrier_highest_transactions', byTx, byTx.txCount, ['transaction_count']);

  const grower = top('revenueDeltaCents');
  if (grower.revenueDeltaCents > 0) push('carrier_fastest_growing', grower, grower.revenueDeltaCents, ['gross_sales'], 'opportunity');
  const decliner = [...rows].sort((a, b) => a.revenueDeltaCents - b.revenueDeltaCents || a.carrier.localeCompare(b.carrier))[0];
  if (decliner.revenueDeltaCents < 0) push('carrier_declining', decliner, decliner.revenueDeltaCents, ['gross_sales'], 'warning');

  return findings;
}
