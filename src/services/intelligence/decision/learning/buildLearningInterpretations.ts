// ============================================================
// R-INTELLIGENCE-F7B: deterministic Learning Interpretation builder.
//
// LearningSignal[] → LearningInterpretation[]. Pure + deterministic: same
// signals → byte-identical interpretations. NO mutation, NO Date.now(), NO
// randomness, NO side effects, NO ranking changes, NO scoring changes, NO
// persistence, NO feedback loops.
//
// One interpretation per signal — F7B does NOT merge or score interpretations.
// ============================================================

import type { LearningSignal, LearningSignalType } from './LearningSignal';
import type {
  LearningInterpretation,
  LearningInterpretationType,
  LearningInterpretationSeverity,
} from './LearningInterpretation';

/** Signal type → interpretation type (1:1, exhaustive over the four signals). */
const TYPE_MAP: Record<LearningSignalType, LearningInterpretationType> = {
  HIGH_COMPLETION: 'STRONG_COMPLETION_PATTERN',
  LOW_COMPLETION: 'WEAK_COMPLETION_PATTERN',
  HIGH_FAILURE: 'ELEVATED_FAILURE_PATTERN',
  HIGH_IGNORE: 'ELEVATED_IGNORE_PATTERN',
};

/** Hardcoded deterministic summary text per interpretation type. No AI. */
const SUMMARY_MAP: Record<LearningInterpretationType, string> = {
  STRONG_COMPLETION_PATTERN: 'Historical outcomes show consistently strong completion rates.',
  WEAK_COMPLETION_PATTERN: 'Historical outcomes show weak completion rates.',
  ELEVATED_FAILURE_PATTERN: 'Historical outcomes indicate elevated failure rates.',
  ELEVATED_IGNORE_PATTERN: 'Historical outcomes indicate elevated ignore rates.',
};

/**
 * Deterministic severity purely from confidence:
 *   >= 1.0 → HIGH · >= 0.75 → MEDIUM · otherwise → LOW
 * No additional heuristics.
 */
export function deriveInterpretationSeverity(
  confidence: number,
): LearningInterpretationSeverity {
  if (confidence >= 1.0) return 'HIGH';
  if (confidence >= 0.75) return 'MEDIUM';
  return 'LOW';
}

/**
 * Pure: LearningSignal[] → LearningInterpretation[]. Empty input → []. Emits one
 * interpretation per signal, in input order (no merging, no scoring).
 */
export function buildLearningInterpretations(
  signals: LearningSignal[],
): LearningInterpretation[] {
  return signals.map((sig) => {
    const interpretationType = TYPE_MAP[sig.signalType];
    return {
      id: `interp:${interpretationType}`,
      interpretationType,
      severity: deriveInterpretationSeverity(sig.confidence),
      confidence: sig.confidence,
      sourceSignalIds: [sig.id],
      summary: SUMMARY_MAP[interpretationType],
    };
  });
}
