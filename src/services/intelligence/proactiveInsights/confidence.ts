// ============================================================
// I6-0A — evidence-confidence evaluation (pure, deterministic).
//
// Confidence measures COMPLETENESS OF EVIDENCE, never performance (same
// separation the I4 Business Manager enforces) and is INDEPENDENT of
// severity. The model stays rule-structured — a sample-size band plus
// explicit caps — with every applied rule echoed as a typed reason code.
// No hidden score, no formula soup, no LLM.
// ============================================================

import type { ConfidenceEvaluation, ConfidenceReason } from './types';
import { MIN_WINDOW_TRANSACTIONS } from './thresholds';

/** Confidence bands by combined canonical transaction count. */
export const CONFIDENCE_BANDS = {
  /** A window under the transaction floor cannot support any claim. */
  insufficient: 0.2,
  smallSample: 0.5,     // combined tx < 10
  moderateSample: 0.7,  // combined tx < 30
  strongSample: 0.9,    // combined tx >= 30
} as const;

/** Band from two complete-period windows' canonical transaction counts.
 *  Both windows are FULL local days by construction (resolved windows end
 *  yesterday), so 'complete_periods' is part of every band explanation. */
export function sampleBandConfidence(currentTx: number, baselineTx: number): ConfidenceEvaluation {
  if (currentTx < MIN_WINDOW_TRANSACTIONS || baselineTx < MIN_WINDOW_TRANSACTIONS) {
    return { value: CONFIDENCE_BANDS.insufficient, reasons: ['complete_periods', 'insufficient_sample'] };
  }
  const combined = currentTx + baselineTx;
  if (combined >= 30) return { value: CONFIDENCE_BANDS.strongSample, reasons: ['complete_periods', 'strong_sample'] };
  if (combined >= 10) return { value: CONFIDENCE_BANDS.moderateSample, reasons: ['complete_periods', 'moderate_sample'] };
  return { value: CONFIDENCE_BANDS.smallSample, reasons: ['complete_periods', 'small_sample'] };
}

/** Cap a confidence at `cap` for a structural evidence defect, recording
 *  WHY. Idempotent-reason: never duplicates an already-present code. */
export function capConfidence(base: ConfidenceEvaluation, cap: number, reason: ConfidenceReason): ConfidenceEvaluation {
  return {
    value: Math.min(base.value, cap),
    reasons: base.reasons.includes(reason) ? base.reasons : [...base.reasons, reason],
  };
}
