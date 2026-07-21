// ============================================================
// I6-0 — FIRST detector: material gross-sales change vs baseline.
//
// Canonical values only: both windows go through ctx.computeForRange
// (computeReportMoneyStats — voided/refund policy, store scoping and every
// money rule stay canonical; this file adds ZERO money math beyond the
// change percentage over two canonical totals).
//
// Honest by construction:
//   thin evidence            → insufficient_evidence (no claim, never "all clear")
//   change below threshold   → below_threshold (audited, nothing emitted)
//   material change          → ProactiveInsight with full evidence+thresholds
// ============================================================

import type { StructuredQueryContext } from '../../query/types';
import type { DetectorEvaluation, ProactiveEvidence, ProactiveInsight, ResolvedAnalysisWindows } from '../types';
import { appliedThresholds, MIN_BASELINE_REVENUE_CENTS, MIN_CONFIDENCE, SALES_CRITICAL_DECLINE_PCT, SALES_MATERIAL_CHANGE_PCT } from '../thresholds';
import { evaluateEvidenceConfidence } from '../confidence';

export interface DetectorRun {
  evaluation: DetectorEvaluation;
  insight: ProactiveInsight | null;
}

/** Deterministic rounding to one decimal (same convention the structured
 *  comparison layer uses). */
function pct(current: number, baseline: number): number {
  return Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10;
}

export function runSalesTrendDetector(ctx: StructuredQueryContext, windows: ResolvedAnalysisWindows): DetectorRun {
  const current = ctx.computeForRange(windows.current.range);
  const baseline = ctx.computeForRange(windows.baseline.range);

  const evidence: ProactiveEvidence = {
    metric: 'gross_sales',
    sourceKind: 'canonical_report_money',
    windows,
    currentCents: current.grossSalesCents,
    baselineCents: baseline.grossSalesCents,
    currentTransactionCount: current.txCount,
    baselineTransactionCount: baseline.txCount,
    changePct: baseline.grossSalesCents !== 0 ? pct(current.grossSalesCents, baseline.grossSalesCents) : null,
  };
  const thresholds = appliedThresholds();
  const confidence = evaluateEvidenceConfidence(evidence);
  const evaluation = (status: DetectorEvaluation['status']): DetectorEvaluation =>
    ({ detector: 'sales_material_change', status, evidence, confidence, thresholds });

  // Evidence floor: thin windows or a sub-floor/zero baseline support NO
  // claim in either direction.
  if (
    confidence < MIN_CONFIDENCE
    || evidence.changePct === null
    || evidence.baselineCents < MIN_BASELINE_REVENUE_CENTS
  ) {
    return { evaluation: evaluation('insufficient_evidence'), insight: null };
  }

  if (Math.abs(evidence.changePct) < SALES_MATERIAL_CHANGE_PCT) {
    return { evaluation: evaluation('below_threshold'), insight: null };
  }

  const direction = evidence.changePct > 0 ? 'increase' as const : 'decline' as const;
  const severity = direction === 'increase' ? 'positive' as const
    : evidence.changePct <= -SALES_CRITICAL_DECLINE_PCT ? 'critical' as const
    : 'warning' as const;

  return {
    evaluation: evaluation('emitted'),
    insight: {
      id: `sales_material_change:${windows.current.startYMD}:${windows.current.endYMD}`,
      kind: 'sales_material_change',
      direction,
      severity,
      confidence,
      evidence,
      thresholds,
    },
  };
}
