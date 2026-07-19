// ============================================================
// Business Analyst — service mix analysis (I3-3 Part 10).
//
// Populations (all canonical, no allocation):
//   repairs         — canonical projection of the repairs-only snapshot
//   unlocks         — canonical projection of the unlocks-only snapshot
//   phone payments  — sum of canonical phonePaymentsByProvider totals
//   activations     — sum of canonical activationsByCarrier totals
// Growth/decline vs previous equivalent period + share of total gross/profit.
// Shares are unit-level ratios of canonical outputs (like percentChange) —
// no financial formula is re-implemented.
// ============================================================

import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import { derivePreviousPeriod } from '../query/resolveBusinessDateRange';
import type { InsightFinding } from './types';

export const SERVICE_TREND_MIN_PCT = 15;   // |change| ≥ 15% (with prior activity) → growth/decline finding

export type ServicePopulation = 'repairs' | 'unlocks' | 'phone_payments' | 'activations';

interface ServiceRow {
  population: ServicePopulation;
  revenueCents: number;
  profitCents: number | null;    // null when the canonical rows don't expose it
  previousRevenueCents: number;
}

const rangeOf = (r: ResolvedBusinessDateRange) => ({ startYMD: r.startYMD, endYMD: r.endYMD });

function paymentTotals(stats: ReportMoneyStats): { revenue: number; profit: number } {
  let revenue = 0; let profit = 0;
  for (const b of Object.values(stats.phonePaymentsByProvider)) { revenue += b.totalCents; profit += b.profitCents; }
  return { revenue, profit };
}
function activationTotals(stats: ReportMoneyStats): { revenue: number; profit: number } {
  let revenue = 0; let profit = 0;
  for (const b of Object.values(stats.activationsByCarrier)) { revenue += b.totalCents; profit += b.profitCents; }
  return { revenue, profit };
}

export function analyzeServiceMix(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange): InsightFinding[] {
  const prevRange = derivePreviousPeriod(range);
  const totalCur = ctx.computeForRange(range.range);
  const totalPrev = ctx.computeForRange(prevRange.range);

  const repairsOnly = { sales: [], repairs: ctx.snapshot.repairs, unlocks: [], specialOrders: [], layaways: [], customerReturns: [], vendorReturns: [], inventory: ctx.snapshot.inventory, settings: ctx.snapshot.settings };
  const unlocksOnly = { ...repairsOnly, repairs: [], unlocks: ctx.snapshot.unlocks };

  const repCur = ctx.computeForScopedSnapshot(repairsOnly, range.range);
  const repPrev = ctx.computeForScopedSnapshot(repairsOnly, prevRange.range);
  const unlCur = ctx.computeForScopedSnapshot(unlocksOnly, range.range);
  const unlPrev = ctx.computeForScopedSnapshot(unlocksOnly, prevRange.range);
  const payCur = paymentTotals(totalCur); const payPrev = paymentTotals(totalPrev);
  const actCur = activationTotals(totalCur); const actPrev = activationTotals(totalPrev);

  const rows: ServiceRow[] = [
    { population: 'repairs', revenueCents: repCur.grossSalesCents, profitCents: repCur.totalProfitCents, previousRevenueCents: repPrev.grossSalesCents },
    { population: 'unlocks', revenueCents: unlCur.grossSalesCents, profitCents: unlCur.totalProfitCents, previousRevenueCents: unlPrev.grossSalesCents },
    { population: 'phone_payments', revenueCents: payCur.revenue, profitCents: payCur.profit, previousRevenueCents: payPrev.revenue },
    { population: 'activations', revenueCents: actCur.revenue, profitCents: actCur.profit, previousRevenueCents: actPrev.revenue },
  ];

  const findings: InsightFinding[] = [];
  for (const row of rows) {
    if (row.revenueCents === 0 && row.previousRevenueCents === 0) continue;

    // Share of total gross (and profit where exposed) — informational.
    if (totalCur.grossSalesCents > 0 && row.revenueCents > 0) {
      const sharePct = Math.round((row.revenueCents / totalCur.grossSalesCents) * 1000) / 10;
      const profitSharePct = row.profitCents !== null && totalCur.totalProfitCents > 0
        ? Math.round((row.profitCents / totalCur.totalProfitCents) * 1000) / 10 : null;
      findings.push({
        id: `service_share:${row.population}`, kind: 'service_share', severity: 'information', confidence: 1,
        source: 'canonical_report_money', relatedMetrics: ['gross_sales', 'profit'],
        dateRange: rangeOf(range), magnitude: row.revenueCents,
        data: { population: row.population, revenueCents: row.revenueCents, revenueSharePct: sharePct, profitSharePct },
      });
    }

    // Growth / decline vs previous equivalent period.
    if (row.previousRevenueCents > 0) {
      const pct = Math.round(((row.revenueCents - row.previousRevenueCents) / row.previousRevenueCents) * 1000) / 10;
      if (pct >= SERVICE_TREND_MIN_PCT) {
        findings.push({
          id: `service_growth:${row.population}`, kind: 'service_growth', severity: 'positive', confidence: 1,
          source: 'canonical_report_money', relatedMetrics: ['gross_sales'],
          dateRange: rangeOf(range), magnitude: row.revenueCents - row.previousRevenueCents,
          data: { population: row.population, changePct: pct, currentCents: row.revenueCents, previousCents: row.previousRevenueCents },
        });
      } else if (pct <= -SERVICE_TREND_MIN_PCT) {
        findings.push({
          id: `service_decline:${row.population}`, kind: 'service_decline', severity: 'warning', confidence: 1,
          source: 'canonical_report_money', relatedMetrics: ['gross_sales'],
          dateRange: rangeOf(range), magnitude: row.previousRevenueCents - row.revenueCents,
          data: { population: row.population, changePct: pct, currentCents: row.revenueCents, previousCents: row.previousRevenueCents },
        });
      }
    }
  }
  return findings;
}
