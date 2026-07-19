// ============================================================
// Business Analyst — deterministic anomaly detection (I3-3 Part 6).
//
// RULES ONLY — fixed exported thresholds, canonical inputs, structured
// findings. Rules that require attribution exactness (carriers, employees)
// respect the same I3-2 guards as the executor: if the data cannot support
// an exact statement, the rule is silently skipped (never fabricated).
// ============================================================

import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import { derivePreviousPeriod } from '../query/resolveBusinessDateRange';
import {
  scopeSalesByCarrier, discoverCarriers, countCarrierImpureSales,
  snapshotWithSales, employeeSnapshot, discoverEmployees, countUnattributedServiceRecords,
} from '../query/scopeBusinessQueryData';
import type { InsightFinding } from './types';

// ── exported deterministic thresholds (tests pin these) ─────
export const ROLLING_AVERAGE_PERIODS = 4;
export const LOW_SALES_RATIO = 0.6;            // current < 60% of rolling avg
export const MARGIN_DROP_PP = 10;              // percentage points
export const EMPLOYEE_LOW_RATIO = 0.5;         // current < 50% of previous
export const LARGE_REFUND_SHARE = 0.2;         // refunds > 20% of gross

const rangeOf = (r: ResolvedBusinessDateRange) => ({ startYMD: r.startYMD, endYMD: r.endYMD });

export function detectAnomalies(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange): InsightFinding[] {
  const findings: InsightFinding[] = [];
  const current = ctx.computeForRange(range.range);
  const prevRange = derivePreviousPeriod(range);
  const previous = ctx.computeForRange(prevRange.range);

  // 1. Sales far below the rolling average of the preceding equal periods.
  {
    let cursor = range;
    const priors: number[] = [];
    for (let i = 0; i < ROLLING_AVERAGE_PERIODS; i++) {
      cursor = derivePreviousPeriod(cursor);
      priors.push(ctx.computeForRange(cursor.range).grossSalesCents);
    }
    const nonZero = priors.filter((v) => v > 0);
    if (nonZero.length >= 2) {
      const avg = priors.reduce((s, v) => s + v, 0) / priors.length;
      if (avg > 0 && current.grossSalesCents < avg * LOW_SALES_RATIO) {
        findings.push({
          id: 'sales_below_rolling_average:gross_sales',
          kind: 'sales_below_rolling_average', severity: 'critical',
          confidence: Math.min(1, nonZero.length / ROLLING_AVERAGE_PERIODS),
          source: 'canonical_report_money', relatedMetrics: ['gross_sales'],
          dateRange: rangeOf(range), magnitude: Math.round(avg - current.grossSalesCents),
          data: { currentCents: current.grossSalesCents, rollingAverageCents: Math.round(avg), periods: ROLLING_AVERAGE_PERIODS },
        });
      }
    }
  }

  // 2. Margin suddenly dropped (canonical meaningful both sides).
  if (current.profitMarginMeaningful && previous.profitMarginMeaningful) {
    const ppDelta = current.profitMargin - previous.profitMargin;
    if (ppDelta <= -MARGIN_DROP_PP) {
      findings.push({
        id: 'margin_drop:margin', kind: 'margin_drop', severity: 'warning', confidence: 1,
        source: 'canonical_report_money', relatedMetrics: ['margin'],
        dateRange: rangeOf(range), magnitude: Math.abs(Math.round(ppDelta * 10) / 10),
        data: { currentMarginPct: current.profitMargin, previousMarginPct: previous.profitMargin, dropPp: Math.round(ppDelta * 10) / 10 },
      });
    }
  }

  // 3. Carrier disappeared (EXACT only: both ranges must be carrier-pure).
  if (countCarrierImpureSales(ctx.snapshot.sales || []) === 0) {
    for (const carrier of discoverCarriers(ctx.snapshot.sales || [])) {
      const scoped = scopeSalesByCarrier(ctx.snapshot.sales || [], carrier).sales;
      const cur = ctx.computeForScopedSnapshot(snapshotWithSales(ctx.snapshot, scoped), range.range).grossSalesCents;
      const prev = ctx.computeForScopedSnapshot(snapshotWithSales(ctx.snapshot, scoped), prevRange.range).grossSalesCents;
      if (prev > 0 && cur === 0) {
        findings.push({
          id: `carrier_disappeared:${carrier}`, kind: 'carrier_disappeared', severity: 'warning', confidence: 1,
          source: 'canonical_report_money', relatedMetrics: ['gross_sales'],
          dateRange: rangeOf(range), magnitude: prev,
          data: { carrier, previousCents: prev },
        });
      }
    }
  }

  // 4. Employee unusually low (EXACT only: full attribution in both ranges).
  if (countUnattributedServiceRecords(ctx.snapshot, range.range) === 0
    && countUnattributedServiceRecords(ctx.snapshot, prevRange.range) === 0) {
    for (const name of discoverEmployees(ctx.snapshot)) {
      const scoped = employeeSnapshot(ctx.snapshot, { name });
      const cur = ctx.computeForScopedSnapshot(scoped, range.range).grossSalesCents;
      const prev = ctx.computeForScopedSnapshot(scoped, prevRange.range).grossSalesCents;
      if (prev > 0 && cur < prev * EMPLOYEE_LOW_RATIO) {
        findings.push({
          id: `employee_unusually_low:${name.toLowerCase()}`, kind: 'employee_unusually_low', severity: 'information', confidence: 1,
          source: 'canonical_report_money', relatedMetrics: ['gross_sales'],
          dateRange: rangeOf(range), magnitude: prev - cur,
          data: { employee: name, currentCents: cur, previousCents: prev },
        });
      }
    }
  }

  // 5. Product stopped selling (canonical topItems rows: sold before, zero now).
  {
    const currentNames = new Set(current.topItems.filter((i) => i.revenueCents > 0).map((i) => i.name));
    for (const item of previous.topItems) {
      if (item.revenueCents > 0 && !currentNames.has(item.name)) {
        findings.push({
          id: `product_stopped_selling:${item.name.toLowerCase()}`, kind: 'product_stopped_selling', severity: 'information', confidence: 0.8,
          source: 'canonical_report_money', relatedMetrics: ['gross_sales'],
          dateRange: rangeOf(range), magnitude: item.revenueCents,
          data: { product: item.name, previousCents: item.revenueCents },
        });
      }
    }
  }

  // 6. Large refund period (canonical return/refund adjustments vs gross).
  if (current.grossSalesCents > 0
    && current.returnAndRefundAdjustmentsCents > current.grossSalesCents * LARGE_REFUND_SHARE) {
    findings.push({
      id: 'large_refund_period:returns', kind: 'large_refund_period', severity: 'warning', confidence: 1,
      source: 'canonical_report_money', relatedMetrics: ['returns', 'gross_sales'],
      dateRange: rangeOf(range), magnitude: current.returnAndRefundAdjustmentsCents,
      data: { refundedCents: current.returnAndRefundAdjustmentsCents, grossCents: current.grossSalesCents },
    });
  }

  return findings;
}
