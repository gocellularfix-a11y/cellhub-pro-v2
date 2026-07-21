// ============================================================
// CELLHUB-INTELLIGENCE-I6-0 — Proactive Insight foundation types.
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

// ── analysis windows ────────────────────────────────────────
export type AnalysisWindowLabel = 'current_7_full_days' | 'baseline_previous_7_days';

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

// ── evidence ────────────────────────────────────────────────
export type ProactiveMetric = 'gross_sales';

/** Everything the threshold/confidence evaluation saw — the full audit
 *  trail. Canonical values only (computeReportMoneyStats fields). */
export interface ProactiveEvidence {
  metric: ProactiveMetric;
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

// ── thresholds (echoed into every insight for explainability) ──
export interface AppliedThresholds {
  materialChangePct: number;
  criticalDeclinePct: number;
  minBaselineRevenueCents: number;
  minWindowTransactions: number;
  minConfidence: number;
}

// ── insight ─────────────────────────────────────────────────
export type ProactiveInsightKind = 'sales_material_change';
export type ProactiveInsightDirection = 'increase' | 'decline';
/** Severity mirrors the I3-3 vocabulary consumers already understand. */
export type ProactiveInsightSeverity = 'critical' | 'warning' | 'positive';

export interface ProactiveInsight {
  /** Deterministic: `${kind}:${current.startYMD}:${current.endYMD}`. */
  id: string;
  kind: ProactiveInsightKind;
  direction: ProactiveInsightDirection;
  severity: ProactiveInsightSeverity;
  /** 0..1 EVIDENCE confidence (completeness of support), never a score. */
  confidence: number;
  evidence: ProactiveEvidence;
  thresholds: AppliedThresholds;
}

// ── per-detector outcome (explainable non-emissions) ────────
export type DetectorOutcomeStatus =
  | 'emitted'
  | 'below_threshold'
  /** Baseline/current evidence too thin to support ANY claim — silence is
   *  honest refusal, never "all clear". */
  | 'insufficient_evidence';

export interface DetectorEvaluation {
  detector: ProactiveInsightKind;
  status: DetectorOutcomeStatus;
  /** Present for every status — the evaluation is auditable either way. */
  evidence: ProactiveEvidence;
  confidence: number;
  thresholds: AppliedThresholds;
}

export interface ProactiveInsightsResult {
  referenceYMD: string;
  insights: ProactiveInsight[];
  /** One entry per detector run, including non-emissions. */
  evaluations: DetectorEvaluation[];
}
