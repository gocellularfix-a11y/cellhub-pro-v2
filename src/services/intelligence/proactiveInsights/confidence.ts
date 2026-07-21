// ============================================================
// I6-0 — evidence-confidence evaluation (pure, deterministic).
//
// Confidence measures COMPLETENESS OF EVIDENCE, never performance (same
// separation the I4 Business Manager enforces). Bands are exported so tests
// and future consumers share one contract.
// ============================================================

import type { ProactiveEvidence } from './types';
import { MIN_WINDOW_TRANSACTIONS } from './thresholds';

/** Confidence bands by combined canonical transaction count. */
export const CONFIDENCE_BANDS = {
  /** A window under the transaction floor cannot support any claim. */
  insufficient: 0.2,
  smallSample: 0.5,     // combined tx < 10
  moderateSample: 0.7,  // combined tx < 30
  strongSample: 0.9,    // combined tx >= 30
} as const;

export function evaluateEvidenceConfidence(evidence: ProactiveEvidence): number {
  if (
    evidence.currentTransactionCount < MIN_WINDOW_TRANSACTIONS
    || evidence.baselineTransactionCount < MIN_WINDOW_TRANSACTIONS
  ) {
    return CONFIDENCE_BANDS.insufficient;
  }
  const combined = evidence.currentTransactionCount + evidence.baselineTransactionCount;
  if (combined >= 30) return CONFIDENCE_BANDS.strongSample;
  if (combined >= 10) return CONFIDENCE_BANDS.moderateSample;
  return CONFIDENCE_BANDS.smallSample;
}
