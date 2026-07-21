// ============================================================
// I6-0A — Detector 4: evidence quality (structural root causes).
//
// Detects WHY evidence is weak, as typed root causes — one insight per
// deduplicated cause, category data_quality, direction neutral. Ownership
// contract: business detectors SUPPRESS their conclusion when evidence is
// weak (their diagnostics say why); THIS detector describes each root
// cause exactly once. Canonical totals are carried UNTOUCHED into the
// evidence — nothing here recalculates or adjusts money, and a lack of
// evidence is surfaced, never presented as a healthy state. Root causes
// never auto-convert into I5 actions.
// ============================================================

import type {
  DetectorRunResult, DiagnosticReason, EvidenceQualityCause, EvidenceQualityEvidence,
  ProactiveInsight, ProactiveInsightContext, ProactiveInsightDetector, ProactiveInsightSeverity,
  ConfidenceReason,
} from '../types';
import {
  EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE, LOW_COST_COVERAGE,
  MIN_CUSTOMER_ATTRIBUTION_SHARE, STALE_ACTIVITY_DAYS,
} from '../thresholds';
import { CONFIDENCE_BANDS } from '../confidence';
import { buildFingerprint } from '../fingerprint';
import { costCoverageOf, customerAttributionShare, salesInRange, scanActivityDates } from '../evidenceMeasures';
import { resolveTrailingWindow } from '../analysisWindow';
import { countCarrierImpureSales, itemCarrier } from '../../query/scopeBusinessQueryData';

const APPLIED = {
  lowCostCoverage: LOW_COST_COVERAGE,
  excessiveUnknownClassificationShare: EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE,
  minCustomerAttributionShare: MIN_CUSTOMER_ATTRIBUTION_SHARE,
  staleActivityDays: STALE_ACTIVITY_DAYS,
};

/** Explicit severity rule per structural cause (business impact of the
 *  data defect, never derived from confidence). */
const CAUSE_SEVERITY: Record<EvidenceQualityCause, ProactiveInsightSeverity> = {
  insufficient_cost_coverage: 'watch',
  excessive_unknown_classification: 'watch',
  absent_activity: 'watch',
  stale_activity: 'watch',
  insufficient_history: 'info',
  missing_customer_attribution: 'info',
};

/** Confidence-reason vocabulary per cause: the measurement is a direct
 *  structural observation over complete windows. */
const CAUSE_REASON: Record<EvidenceQualityCause, ConfidenceReason> = {
  insufficient_cost_coverage: 'low_cost_coverage',
  excessive_unknown_classification: 'complete_periods',
  absent_activity: 'no_activity',
  stale_activity: 'stale_activity',
  insufficient_history: 'insufficient_history',
  missing_customer_attribution: 'complete_periods',
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function run(context: ProactiveInsightContext): DetectorRunResult {
  const windows = context.windows7;
  const currentStats = context.query.computeForRange(windows.current.range);
  const allSales = context.query.snapshot.sales || [];
  const activity = scanActivityDates(allSales);

  // Deduplicated cause set (each structural cause appears at most once).
  const causes = new Map<EvidenceQualityCause, { measuredRatio: number | null; ratioThreshold: number | null }>();

  // 1) Absent vs stale activity (absent supersedes stale — one root cause).
  if (currentStats.txCount === 0) {
    causes.set('absent_activity', { measuredRatio: null, ratioThreshold: null });
  } else {
    // Stale = no recorded activity within the last STALE_ACTIVITY_DAYS full
    // days (shared trailing-window helper resolves the cutoff).
    const staleCutoffYMD = resolveTrailingWindow(context.query.referenceDate, STALE_ACTIVITY_DAYS, 'trailing_activity_cutoff').startYMD;
    if (activity.latestYMD !== null && activity.latestYMD < staleCutoffYMD) {
      causes.set('stale_activity', { measuredRatio: null, ratioThreshold: null });
    }
  }

  // 2) Cost coverage over the canonical current window.
  const coverage = costCoverageOf(currentStats);
  if (coverage !== null && coverage < LOW_COST_COVERAGE) {
    causes.set('insufficient_cost_coverage', { measuredRatio: coverage, ratioThreshold: LOW_COST_COVERAGE });
  }

  // 3) History does not span the baseline window.
  if (activity.earliestYMD !== null && activity.earliestYMD > windows.baseline.startYMD) {
    causes.set('insufficient_history', { measuredRatio: null, ratioThreshold: null });
  }

  // 4) Excessive unknown/ambiguous carrier classification (canonical
  //    classifier reused — impure share among carrier-touching sales).
  const sales30 = salesInRange(allSales, context.window30.range);
  const carrierTouching = sales30.filter((s) => (s.items || []).some((it) => itemCarrier(it) !== '')).length;
  if (carrierTouching > 0) {
    const unknownShare = round3(countCarrierImpureSales(sales30) / carrierTouching);
    if (unknownShare >= EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE) {
      causes.set('excessive_unknown_classification', { measuredRatio: unknownShare, ratioThreshold: EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE });
    }
  }

  // 5) Missing customer attribution (customer-scoped metrics require it).
  const attribution = customerAttributionShare(allSales, windows.current.range);
  if (attribution !== null && attribution < MIN_CUSTOMER_ATTRIBUTION_SHARE) {
    causes.set('missing_customer_attribution', { measuredRatio: attribution, ratioThreshold: MIN_CUSTOMER_ATTRIBUTION_SHARE });
  }

  const insights: ProactiveInsight[] = [...causes.entries()].map(([cause, m]) => {
    const evidence: EvidenceQualityEvidence = {
      detectorId: 'evidence_quality',
      metric: 'data_quality',
      sourceKind: 'canonical_report_money',
      cause,
      windows,
      // ORIGINAL canonical totals, preserved untouched.
      currentGrossSalesCents: currentStats.grossSalesCents,
      currentTransactionCount: currentStats.txCount,
      measuredRatio: m.measuredRatio,
      ratioThreshold: m.ratioThreshold,
      lastActivityYMD: activity.latestYMD,
      earliestActivityYMD: activity.earliestYMD,
    };
    return {
      fingerprint: buildFingerprint({
        detectorId: 'evidence_quality', storeId: context.storeId, category: 'data_quality',
        ranges: [windows.current, windows.baseline], dimension: cause, direction: 'neutral',
      }),
      detectorId: 'evidence_quality' as const,
      category: 'data_quality' as const,
      severity: CAUSE_SEVERITY[cause],
      direction: 'neutral' as const,
      // Direct structural observation over complete windows — strong-band
      // confidence with the cause-specific reason code.
      confidence: CONFIDENCE_BANDS.strongSample,
      confidenceReasons: ['complete_periods', CAUSE_REASON[cause]].filter((r, i, a) => a.indexOf(r) === i) as ConfidenceReason[],
      evidence,
      thresholds: APPLIED,
    };
  });

  const reasons: DiagnosticReason[] = insights.length === 0 ? ['no_quality_issues_detected'] : [];
  return {
    insights,
    diagnostic: {
      detectorId: 'evidence_quality',
      status: insights.length > 0 ? 'emitted' : 'below_threshold',
      reasons,
      evidence: insights[0]?.evidence ?? null,
      confidence: CONFIDENCE_BANDS.strongSample,
      emittedCount: insights.length,
    },
  };
}

export const evidenceQualityDetector: ProactiveInsightDetector = {
  id: 'evidence_quality',
  category: 'data_quality',
  run,
};
