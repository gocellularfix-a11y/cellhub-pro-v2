// ============================================================
// CELLHUB-INTELLIGENCE-I6-0A — Proactive Insight foundation contracts.
//
// A proactive insight is NOT free-form commentary: it is a structured result
// produced from canonical business data through the fixed flow
//   canonical data → resolved window → detector → structured evidence
//   → threshold evaluation → confidence evaluation → ProactiveInsight.
//
// STRUCTURES ONLY. No text anywhere — presentation belongs to future
// presenter/Business Manager/alert rounds. Read-only, deterministic,
// store-scoped, canonically calculated, explainable by construction
// (every insight carries its evidence AND the thresholds applied).
// ============================================================

import type { LocalDayRange } from '@/utils/reportRange';
import type { StructuredQueryContext } from '../query/types';

// ── analysis windows ────────────────────────────────────────
export type AnalysisWindowLabel =
  | 'current_7_full_days'
  | 'baseline_previous_7_days'
  | 'current_30_full_days'
  /** Internal cutoff resolution (stale-activity check) — never published. */
  | 'trailing_activity_cutoff';

export interface AnalysisWindow {
  label: AnalysisWindowLabel;
  startYMD: string;
  endYMD: string;
  /** Canonical local-day range (both boundaries inclusive). */
  range: LocalDayRange;
  dayCount: number;
}

/** Current vs baseline, resolved from an injected reference date. The
 *  current window ends YESTERDAY (today is a partial day and would skew a
 *  deterministic comparison); baseline is the previous non-overlapping
 *  equal-length window. */
export interface ResolvedAnalysisWindows {
  referenceYMD: string;
  current: AnalysisWindow;
  baseline: AnalysisWindow;
}

// ── taxonomy ────────────────────────────────────────────────
export type ProactiveInsightCategory =
  | 'sales'
  | 'profit'
  | 'margin'
  | 'customers'
  | 'products'
  | 'carriers'
  | 'operations'
  | 'data_quality';

/** Severity = BUSINESS IMPACT of the finding (never derived from
 *  confidence, never a performance grade). */
export type ProactiveInsightSeverity = 'info' | 'watch' | 'important' | 'critical';

/** Direction = whether the underlying movement favors the business.
 *  Exposure/data-quality findings are 'neutral'. */
export type ProactiveInsightDirection = 'positive' | 'negative' | 'neutral';

// ── confidence (evidence quality, explicable) ───────────────
/** Typed reason codes — the WHOLE explanation of a confidence value.
 *  Structured vocabulary, never free text. */
export type ConfidenceReason =
  | 'complete_periods'
  | 'strong_sample'
  | 'moderate_sample'
  | 'small_sample'
  | 'insufficient_sample'
  | 'zero_baseline'
  | 'low_cost_coverage'
  | 'invalid_margin_denominator'
  | 'insufficient_history'
  | 'stale_activity'
  | 'no_activity';

export interface ConfidenceEvaluation {
  /** 0..1 — completeness of EVIDENCE, independent of severity/performance. */
  value: number;
  reasons: ConfidenceReason[];
}

// ── per-detector structured evidence ────────────────────────
export interface SalesMomentumEvidence {
  detectorId: 'sales_momentum';
  metric: 'gross_sales';
  sourceKind: 'canonical_report_money';
  windows: ResolvedAnalysisWindows;
  currentCents: number;
  baselineCents: number;
  currentTransactionCount: number;
  baselineTransactionCount: number;
  /** Signed percentage vs baseline; null when the baseline is zero (a
   *  from-zero change has no meaningful percentage — never Infinity). */
  changePct: number | null;
}

export interface GrossMarginPressureEvidence {
  detectorId: 'gross_margin_pressure';
  metric: 'margin';
  sourceKind: 'canonical_report_money';
  windows: ResolvedAnalysisWindows;
  currentGrossSalesCents: number;
  baselineGrossSalesCents: number;
  currentGrossProfitCents: number;
  baselineGrossProfitCents: number;
  /** Canonical profitMargin per window; null when the canonical
   *  profitMarginMeaningful flag is false (never a fabricated 0%). */
  currentMarginPct: number | null;
  baselineMarginPct: number | null;
  /** PERCENTAGE POINTS (40% → 32% = −8), never a relative percent. */
  marginChangePoints: number | null;
  /** Revenue-weighted fraction of canonical POS lines carrying a recorded
   *  cost, per window; null when the window has no revenue lines. */
  currentCostCoverage: number | null;
  baselineCostCoverage: number | null;
  currentTransactionCount: number;
  baselineTransactionCount: number;
}

export interface CarrierShareRow {
  carrier: string;
  /** Canonical txCount of the carrier's PURE single-carrier sales. */
  transactionCount: number;
}

export interface CarrierConcentrationEvidence {
  detectorId: 'carrier_concentration';
  metric: 'transaction_count';
  sourceKind: 'canonical_report_money';
  window: AnalysisWindow;
  topCarrier: string;
  /** Carriers tied with the top (deterministic tie-break already applied). */
  tiedWith: string[];
  topCarrierTransactionCount: number;
  totalEligibleTransactionCount: number;
  /** topCarrier / totalEligible, rounded to 3 decimals. */
  concentration: number;
  perCarrier: CarrierShareRow[];
  /** Carrier-impure sales EXCLUDED from the eligible population. */
  excludedMixedSales: number;
}

/** Structural root causes of weak evidence — the data_quality vocabulary. */
export type EvidenceQualityCause =
  | 'insufficient_cost_coverage'
  | 'insufficient_history'
  | 'excessive_unknown_classification'
  | 'missing_customer_attribution'
  | 'absent_activity'
  | 'stale_activity';

export interface EvidenceQualityEvidence {
  detectorId: 'evidence_quality';
  metric: 'data_quality';
  sourceKind: 'canonical_report_money';
  cause: EvidenceQualityCause;
  windows: ResolvedAnalysisWindows;
  /** ORIGINAL canonical totals, preserved untouched (never recomputed). */
  currentGrossSalesCents: number;
  currentTransactionCount: number;
  /** Cause-specific measured ratio (coverage/share), null when not ratio-shaped. */
  measuredRatio: number | null;
  /** Threshold the ratio was evaluated against, null when not ratio-shaped. */
  ratioThreshold: number | null;
  /** YMD of the most recent recorded activity; null when none exists. */
  lastActivityYMD: string | null;
  /** YMD of the earliest recorded activity; null when none exists. */
  earliestActivityYMD: string | null;
}

export type ProactiveInsightEvidence =
  | SalesMomentumEvidence
  | GrossMarginPressureEvidence
  | CarrierConcentrationEvidence
  | EvidenceQualityEvidence;

// ── insight ─────────────────────────────────────────────────
export type ProactiveDetectorId =
  | 'sales_momentum'
  | 'gross_margin_pressure'
  | 'carrier_concentration'
  | 'evidence_quality';

export interface ProactiveInsight {
  /** Deterministic composite fingerprint — see buildFingerprint():
   *  detector : store : category : ranges : primary dimension : direction.
   *  Same snapshot + same referenceDate → same fingerprint, forever. */
  fingerprint: string;
  detectorId: ProactiveDetectorId;
  category: ProactiveInsightCategory;
  severity: ProactiveInsightSeverity;
  direction: ProactiveInsightDirection;
  /** 0..1 EVIDENCE confidence (completeness of support), never a score. */
  confidence: number;
  confidenceReasons: ConfidenceReason[];
  evidence: ProactiveInsightEvidence;
  /** Named thresholds applied to THIS insight (explainable without source). */
  thresholds: Record<string, number>;
}

// ── per-detector diagnostics (explainable non-emissions + failures) ──
export type DetectorOutcomeStatus =
  | 'emitted'
  | 'below_threshold'
  /** Evidence too thin to support ANY claim — silence is honest refusal,
   *  never "all clear". */
  | 'insufficient_evidence'
  /** The detector threw or produced non-finite public numbers; isolated by
   *  the engine — NO fake insight is ever fabricated from a failure. */
  | 'detector_error';

/** Typed non-emission/suppression reasons (structured, never free text). */
export type DiagnosticReason =
  | ConfidenceReason
  | 'change_below_material_threshold'
  | 'baseline_below_revenue_floor'
  | 'margin_change_below_material_threshold'
  | 'concentration_below_threshold'
  | 'no_eligible_carrier_activity'
  | 'no_quality_issues_detected'
  | 'detector_exception'
  | 'non_finite_public_number';

export interface ProactiveInsightDiagnostic {
  detectorId: ProactiveDetectorId;
  status: DetectorOutcomeStatus;
  reasons: DiagnosticReason[];
  /** Present when the detector ran far enough to assemble evidence. */
  evidence: ProactiveInsightEvidence | null;
  confidence: number;
  emittedCount: number;
}

// ── detector + context contracts ────────────────────────────
/** Read-only execution context for detectors: the SAME canonical
 *  store-scoped StructuredQueryContext the I3-2 executor uses, plus the
 *  shared pre-resolved windows (detectors never do date math themselves). */
export interface ProactiveInsightContext {
  query: StructuredQueryContext;
  /** 7 full local days ending yesterday vs previous 7 (no overlap). */
  windows7: ResolvedAnalysisWindows;
  /** 30 full local days ending yesterday. */
  window30: AnalysisWindow;
  referenceYMD: string;
  /** Active store scope carried into fingerprints; null = single store. */
  storeId: string | null;
}

export interface DetectorRunResult {
  insights: ProactiveInsight[];
  diagnostic: ProactiveInsightDiagnostic;
}

export interface ProactiveInsightDetector {
  id: ProactiveDetectorId;
  category: ProactiveInsightCategory;
  run(context: ProactiveInsightContext): DetectorRunResult;
}

export interface ProactiveInsightsResult {
  referenceYMD: string;
  /** Deduped by fingerprint, stably ordered (severity → category →
   *  fingerprint), capped at MAX_INSIGHTS_PER_RUN. */
  insights: ProactiveInsight[];
  /** One entry per registered detector, including failures. */
  diagnostics: ProactiveInsightDiagnostic[];
}
