// ============================================================
// Proactive Insight foundation (I6-0 / I6-0A) — public surface.
// ============================================================

export type {
  AnalysisWindow, AnalysisWindowLabel, ResolvedAnalysisWindows,
  ProactiveInsightCategory, ProactiveInsightSeverity, ProactiveInsightDirection,
  ConfidenceReason, ConfidenceEvaluation,
  SalesMomentumEvidence, GrossMarginPressureEvidence,
  CarrierShareRow, CarrierConcentrationEvidence,
  EvidenceQualityCause, EvidenceQualityEvidence, ProactiveInsightEvidence,
  ProactiveDetectorId, ProactiveInsight,
  DetectorOutcomeStatus, DiagnosticReason, ProactiveInsightDiagnostic,
  ProactiveInsightContext, DetectorRunResult, ProactiveInsightDetector,
  ProactiveInsightsResult,
} from './types';

export {
  resolveAnalysisWindows, resolveTrailingWindow, resolveCarrierWindow, ANALYSIS_WINDOW_DAYS,
} from './analysisWindow';
export {
  SALES_MATERIAL_CHANGE_PCT, SALES_CRITICAL_DECLINE_PCT,
  MIN_BASELINE_REVENUE_CENTS, MIN_WINDOW_TRANSACTIONS, MIN_CONFIDENCE,
  MARGIN_MATERIAL_CHANGE_POINTS, MARGIN_CRITICAL_DROP_POINTS, MIN_COST_COVERAGE_FOR_MARGIN_CLAIM,
  CARRIER_WINDOW_DAYS, CARRIER_HIGH_CONCENTRATION_SHARE, CARRIER_SEVERE_CONCENTRATION_SHARE,
  CARRIER_MIN_ELIGIBLE_TRANSACTIONS,
  LOW_COST_COVERAGE, EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE, MIN_CUSTOMER_ATTRIBUTION_SHARE,
  STALE_ACTIVITY_DAYS, MAX_INSIGHTS_PER_RUN,
} from './thresholds';
export { sampleBandConfidence, capConfidence, CONFIDENCE_BANDS } from './confidence';
export { buildFingerprint } from './fingerprint';
export { costCoverageOf, customerAttributionShare, scanActivityDates, salesInRange } from './evidenceMeasures';
export { salesMomentumDetector } from './detectors/salesMomentumDetector';
export { grossMarginPressureDetector } from './detectors/grossMarginPressureDetector';
export { carrierConcentrationDetector } from './detectors/carrierConcentrationDetector';
export { evidenceQualityDetector } from './detectors/evidenceQualityDetector';
export {
  runProactiveInsightDetectors, buildProactiveContext, PROACTIVE_DETECTORS, hasNonFinitePublicValue,
} from './proactiveInsightEngine';
