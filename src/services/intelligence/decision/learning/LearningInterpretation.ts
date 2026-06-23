// ============================================================
// R-INTELLIGENCE-F7B: LearningInterpretation canonical model.
//
// F7B converts read-only LearningSignals into deterministic INTERPRETATIONS —
// it creates MEANING, not ACTION. It does NOT change ranking, does NOT change
// scoring, does NOT adapt behavior, does NOT create feedback loops, and does
// NOT persist memory.
//
// Identity is deterministic (`interp:${interpretationType}`) and carries NO
// timestamp. Same signals → byte-identical interpretations.
// ============================================================

/**
 * The meaning derived from a single LearningSignal. One-to-one with the signal
 * types (F7B does not merge or score interpretations):
 *  - STRONG_COMPLETION_PATTERN ← HIGH_COMPLETION
 *  - WEAK_COMPLETION_PATTERN   ← LOW_COMPLETION
 *  - ELEVATED_FAILURE_PATTERN  ← HIGH_FAILURE
 *  - ELEVATED_IGNORE_PATTERN   ← HIGH_IGNORE
 */
export type LearningInterpretationType =
  | 'STRONG_COMPLETION_PATTERN'
  | 'WEAK_COMPLETION_PATTERN'
  | 'ELEVATED_FAILURE_PATTERN'
  | 'ELEVATED_IGNORE_PATTERN';

/** Deterministic severity band, derived ONLY from the signal's confidence. */
export type LearningInterpretationSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/** A single deterministic interpretation of one learning signal. */
export interface LearningInterpretation {
  /** Deterministic, idempotent: `interp:${interpretationType}`. */
  id: string;
  /** What pattern the underlying signal represents. */
  interpretationType: LearningInterpretationType;
  /** Severity band, derived purely from confidence. */
  severity: LearningInterpretationSeverity;
  /** Carried through from the source signal (no recompute). */
  confidence: number;
  /** Ids of the signal(s) this interpretation was derived from (F7B: exactly one). */
  sourceSignalIds: string[];
  /** Hardcoded, deterministic template text. No AI generation. */
  summary: string;
}
