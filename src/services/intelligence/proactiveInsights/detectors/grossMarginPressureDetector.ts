// ============================================================
// I6-0A — Detector 2: gross margin pressure (percentage-point moves).
//
// Compares the SAME shared complete 7v7 windows used by sales momentum.
// Every number is canonical (computeReportMoneyStats): grossSalesCents,
// totalProfitCents, profitMargin, profitMarginMeaningful. This file does
// NOT re-derive sales/refunds/cost/profit/margin — it only subtracts two
// canonical margin percentages to get PERCENTAGE POINTS:
//   40% → 32%  ⇒  marginChangePoints = −8   (NEVER "−20% margin").
//
// Honesty rules:
//   invalid denominator (profitMarginMeaningful=false, incl. zero revenue)
//     → insufficient_evidence, margin never fabricated as 0%.
//   cost coverage < MIN_COST_COVERAGE_FOR_MARGIN_CLAIM
//     → the margin CONCLUSION is suppressed (insufficient_evidence);
//       evidence_quality owns the root-cause insight (single ownership).
//   improvement is emitted as positive movement, never labeled pressure.
// ============================================================

import type {
  DetectorRunResult, DiagnosticReason, GrossMarginPressureEvidence,
  ProactiveInsightContext, ProactiveInsightDetector, ProactiveInsightSeverity,
} from '../types';
import {
  LOW_COST_COVERAGE, MARGIN_CRITICAL_DROP_POINTS, MARGIN_MATERIAL_CHANGE_POINTS,
  MIN_CONFIDENCE, MIN_COST_COVERAGE_FOR_MARGIN_CLAIM, MIN_WINDOW_TRANSACTIONS,
} from '../thresholds';
import { capConfidence, sampleBandConfidence } from '../confidence';
import { buildFingerprint } from '../fingerprint';
import { costCoverageOf } from '../evidenceMeasures';

const APPLIED = {
  marginMaterialChangePoints: MARGIN_MATERIAL_CHANGE_POINTS,
  marginCriticalDropPoints: MARGIN_CRITICAL_DROP_POINTS,
  minCostCoverageForMarginClaim: MIN_COST_COVERAGE_FOR_MARGIN_CLAIM,
  minWindowTransactions: MIN_WINDOW_TRANSACTIONS,
  minConfidence: MIN_CONFIDENCE,
};

const round1 = (x: number) => Math.round(x * 10) / 10;

function run(context: ProactiveInsightContext): DetectorRunResult {
  const windows = context.windows7;
  const current = context.query.computeForRange(windows.current.range);
  const baseline = context.query.computeForRange(windows.baseline.range);

  const currentMargin = current.profitMarginMeaningful ? round1(current.profitMargin) : null;
  const baselineMargin = baseline.profitMarginMeaningful ? round1(baseline.profitMargin) : null;
  const evidence: GrossMarginPressureEvidence = {
    detectorId: 'gross_margin_pressure',
    metric: 'margin',
    sourceKind: 'canonical_report_money',
    windows,
    currentGrossSalesCents: current.grossSalesCents,
    baselineGrossSalesCents: baseline.grossSalesCents,
    currentGrossProfitCents: current.totalProfitCents,
    baselineGrossProfitCents: baseline.totalProfitCents,
    currentMarginPct: currentMargin,
    baselineMarginPct: baselineMargin,
    marginChangePoints: currentMargin !== null && baselineMargin !== null
      ? round1(currentMargin - baselineMargin)
      : null,
    currentCostCoverage: costCoverageOf(current),
    baselineCostCoverage: costCoverageOf(baseline),
    currentTransactionCount: current.txCount,
    baselineTransactionCount: baseline.txCount,
  };

  let confidence = sampleBandConfidence(current.txCount, baseline.txCount);
  const weakCoverage = (evidence.currentCostCoverage !== null && evidence.currentCostCoverage < MIN_COST_COVERAGE_FOR_MARGIN_CLAIM)
    || (evidence.baselineCostCoverage !== null && evidence.baselineCostCoverage < MIN_COST_COVERAGE_FOR_MARGIN_CLAIM);
  if (weakCoverage) confidence = capConfidence(confidence, LOW_COST_COVERAGE, 'low_cost_coverage');
  if (evidence.marginChangePoints === null) confidence = capConfidence(confidence, confidence.value, 'invalid_margin_denominator');

  const diagnostic = (status: 'emitted' | 'below_threshold' | 'insufficient_evidence', reasons: DiagnosticReason[], emittedCount: number) =>
    ({ detectorId: 'gross_margin_pressure' as const, status, reasons, evidence, confidence: confidence.value, emittedCount });

  // No margin conclusion without a valid denominator in BOTH complete
  // windows (zero-revenue windows fall here via profitMarginMeaningful).
  if (evidence.marginChangePoints === null) {
    return { insights: [], diagnostic: diagnostic('insufficient_evidence', ['invalid_margin_denominator'], 0) };
  }
  if (confidence.value < MIN_CONFIDENCE) {
    const reasons: DiagnosticReason[] = weakCoverage ? ['low_cost_coverage'] : ['insufficient_sample'];
    return { insights: [], diagnostic: diagnostic('insufficient_evidence', reasons, 0) };
  }
  if (weakCoverage) {
    // Coverage weak but above the confidence floor is still not enough to
    // present a margin conclusion AS FACT — suppress; evidence_quality owns
    // the root cause.
    return { insights: [], diagnostic: diagnostic('insufficient_evidence', ['low_cost_coverage'], 0) };
  }
  if (Math.abs(evidence.marginChangePoints) < MARGIN_MATERIAL_CHANGE_POINTS) {
    return { insights: [], diagnostic: diagnostic('below_threshold', ['margin_change_below_material_threshold'], 0) };
  }

  // Severity rule (explicit): drop ≥ critical points → critical; material
  // drop → important; material IMPROVEMENT → watch, direction positive
  // (never labeled as pressure).
  const direction = evidence.marginChangePoints > 0 ? 'positive' as const : 'negative' as const;
  const severity: ProactiveInsightSeverity = direction === 'positive' ? 'watch'
    : evidence.marginChangePoints <= -MARGIN_CRITICAL_DROP_POINTS ? 'critical'
    : 'important';

  return {
    insights: [{
      fingerprint: buildFingerprint({
        detectorId: 'gross_margin_pressure', storeId: context.storeId, category: 'margin',
        ranges: [windows.current, windows.baseline], dimension: 'margin', direction,
      }),
      detectorId: 'gross_margin_pressure',
      category: 'margin',
      severity,
      direction,
      confidence: confidence.value,
      confidenceReasons: confidence.reasons,
      evidence,
      thresholds: APPLIED,
    }],
    diagnostic: diagnostic('emitted', [], 1),
  };
}

export const grossMarginPressureDetector: ProactiveInsightDetector = {
  id: 'gross_margin_pressure',
  category: 'margin',
  run,
};
