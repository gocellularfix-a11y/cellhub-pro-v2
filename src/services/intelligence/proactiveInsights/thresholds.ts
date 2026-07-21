// ============================================================
// I6-0 — deterministic proactive thresholds (single source, exported).
//
// Every emitted insight echoes the thresholds applied to it, so a result is
// explainable without reading this file. Change ONLY with auditor approval —
// these values define what "material" means for the whole proactive layer.
// ============================================================

import type { AppliedThresholds } from './types';

/** A sales change is MATERIAL at ±20% vs baseline. */
export const SALES_MATERIAL_CHANGE_PCT = 20;

/** A decline of 40%+ is CRITICAL (still 'warning' below this). */
export const SALES_CRITICAL_DECLINE_PCT = 40;

/** Baseline revenue floor ($100.00): below this, percentage changes are
 *  noise and the detector refuses to claim anything. */
export const MIN_BASELINE_REVENUE_CENTS = 10_000;

/** Each window needs at least this many canonical transactions to support
 *  a claim about the business (not about one sale). */
export const MIN_WINDOW_TRANSACTIONS = 3;

/** Insights below this evidence confidence are never emitted. */
export const MIN_CONFIDENCE = 0.5;

export function appliedThresholds(): AppliedThresholds {
  return {
    materialChangePct: SALES_MATERIAL_CHANGE_PCT,
    criticalDeclinePct: SALES_CRITICAL_DECLINE_PCT,
    minBaselineRevenueCents: MIN_BASELINE_REVENUE_CENTS,
    minWindowTransactions: MIN_WINDOW_TRANSACTIONS,
    minConfidence: MIN_CONFIDENCE,
  };
}
