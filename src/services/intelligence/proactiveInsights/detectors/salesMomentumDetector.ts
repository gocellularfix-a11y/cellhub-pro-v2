// ============================================================
// I6-0A — Detector 1: sales momentum (material gross-sales change).
//
// ID mapping: this is the I6-0 `sales_material_change` detector renamed to
// the mandated `sales_momentum` — same logic, same thresholds. Rename was
// safe: no consumer nor persisted fingerprint existed at rename time.
//
// Canonical values only: both windows go through ctx.query.computeForRange
// (computeReportMoneyStats — voided/refund policy, store scoping and every
// money rule stay canonical; this file adds ZERO money math beyond the
// change percentage over two canonical totals).
//
// Honest by construction:
//   thin evidence            → insufficient_evidence (no claim, never "all clear")
//   zero baseline            → changePct null (never Infinity), no claim
//   change below threshold   → below_threshold (audited, nothing emitted)
//   material change          → ProactiveInsight with full evidence+thresholds
// ============================================================

import type {
  DetectorRunResult, DiagnosticReason, ProactiveInsightContext, ProactiveInsightDetector,
  ProactiveInsightSeverity, SalesMomentumEvidence,
} from '../types';
import {
  MIN_BASELINE_REVENUE_CENTS, MIN_CONFIDENCE, MIN_WINDOW_TRANSACTIONS,
  SALES_CRITICAL_DECLINE_PCT, SALES_MATERIAL_CHANGE_PCT,
} from '../thresholds';
import { sampleBandConfidence } from '../confidence';
import { buildFingerprint } from '../fingerprint';

const APPLIED = {
  materialChangePct: SALES_MATERIAL_CHANGE_PCT,
  criticalDeclinePct: SALES_CRITICAL_DECLINE_PCT,
  minBaselineRevenueCents: MIN_BASELINE_REVENUE_CENTS,
  minWindowTransactions: MIN_WINDOW_TRANSACTIONS,
  minConfidence: MIN_CONFIDENCE,
};

/** Deterministic rounding to one decimal (same convention the structured
 *  comparison layer uses). */
function pct(current: number, baseline: number): number {
  return Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10;
}

function run(context: ProactiveInsightContext): DetectorRunResult {
  const windows = context.windows7;
  const current = context.query.computeForRange(windows.current.range);
  const baseline = context.query.computeForRange(windows.baseline.range);

  const evidence: SalesMomentumEvidence = {
    detectorId: 'sales_momentum',
    metric: 'gross_sales',
    sourceKind: 'canonical_report_money',
    windows,
    currentCents: current.grossSalesCents,
    baselineCents: baseline.grossSalesCents,
    currentTransactionCount: current.txCount,
    baselineTransactionCount: baseline.txCount,
    changePct: baseline.grossSalesCents !== 0 ? pct(current.grossSalesCents, baseline.grossSalesCents) : null,
  };
  const confidence = sampleBandConfidence(current.txCount, baseline.txCount);
  const diagnostic = (status: 'emitted' | 'below_threshold' | 'insufficient_evidence', reasons: DiagnosticReason[], emittedCount: number) =>
    ({ detectorId: 'sales_momentum' as const, status, reasons, evidence, confidence: confidence.value, emittedCount });

  // Evidence floor: thin windows or a sub-floor/zero baseline support NO
  // claim in either direction (never a from-zero "infinite %").
  if (confidence.value < MIN_CONFIDENCE || evidence.changePct === null || evidence.baselineCents < MIN_BASELINE_REVENUE_CENTS) {
    const reasons: DiagnosticReason[] = [];
    if (confidence.value < MIN_CONFIDENCE) reasons.push('insufficient_sample');
    if (evidence.changePct === null) reasons.push('zero_baseline');
    else if (evidence.baselineCents < MIN_BASELINE_REVENUE_CENTS) reasons.push('baseline_below_revenue_floor');
    return { insights: [], diagnostic: diagnostic('insufficient_evidence', reasons, 0) };
  }

  if (Math.abs(evidence.changePct) < SALES_MATERIAL_CHANGE_PCT) {
    return { insights: [], diagnostic: diagnostic('below_threshold', ['change_below_material_threshold'], 0) };
  }

  // Severity = business impact rule (explicit, never from confidence):
  //   material increase → watch (positive movement worth attention)
  //   material decline  → important; decline ≥ critical threshold → critical.
  const direction = evidence.changePct > 0 ? 'positive' as const : 'negative' as const;
  const severity: ProactiveInsightSeverity = direction === 'positive' ? 'watch'
    : evidence.changePct <= -SALES_CRITICAL_DECLINE_PCT ? 'critical'
    : 'important';

  return {
    insights: [{
      fingerprint: buildFingerprint({
        detectorId: 'sales_momentum', storeId: context.storeId, category: 'sales',
        ranges: [windows.current, windows.baseline], dimension: 'gross_sales', direction,
      }),
      detectorId: 'sales_momentum',
      category: 'sales',
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

export const salesMomentumDetector: ProactiveInsightDetector = {
  id: 'sales_momentum',
  category: 'sales',
  run,
};
