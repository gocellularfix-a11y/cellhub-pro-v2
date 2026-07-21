// ============================================================
// Proactive Insight foundation (I6-0) — public surface.
// ============================================================

export type {
  AnalysisWindow, AnalysisWindowLabel, ResolvedAnalysisWindows,
  ProactiveMetric, ProactiveEvidence, AppliedThresholds,
  ProactiveInsight, ProactiveInsightKind, ProactiveInsightDirection, ProactiveInsightSeverity,
  DetectorOutcomeStatus, DetectorEvaluation, ProactiveInsightsResult,
} from './types';

export { resolveAnalysisWindows, ANALYSIS_WINDOW_DAYS } from './analysisWindow';
export {
  appliedThresholds,
  SALES_MATERIAL_CHANGE_PCT, SALES_CRITICAL_DECLINE_PCT,
  MIN_BASELINE_REVENUE_CENTS, MIN_WINDOW_TRANSACTIONS, MIN_CONFIDENCE,
} from './thresholds';
export { evaluateEvidenceConfidence, CONFIDENCE_BANDS } from './confidence';
export { runSalesTrendDetector } from './detectors/salesTrendDetector';
export { runProactiveInsightDetectors } from './proactiveInsightEngine';
