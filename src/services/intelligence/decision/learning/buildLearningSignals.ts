// ============================================================
// R-INTELLIGENCE-F7A: deterministic Learning Signal builder.
//
// OutcomeRegistry → LearningSignal[]. Pure + deterministic: same registry →
// byte-identical signals. NO mutation, NO Date.now(), NO randomness, NO side
// effects, NO ranking changes, NO scoring changes, NO persistence.
//
// It REUSES F6A's counting via summarizeOutcomeRegistry — the rates are never
// recomputed by hand here. Divide-by-zero is guarded by summarizeOutcomes
// (completionRate is 0 when total is 0) and by the early empty-return.
// ============================================================

import type { OutcomeRegistry } from '../outcome/outcomeRegistry';
import { summarizeOutcomeRegistry } from '../outcome/outcomeRegistry';
import type {
  LearningSignal,
  LearningSignalType,
  LearningSubjectType,
} from './LearningSignal';

/** GLOBAL-only scope for F7A — no per-customer / per-action-type learning. */
const SUBJECT_TYPE: LearningSubjectType = 'GLOBAL';
const SUBJECT_ID = 'global';

/** Deterministic global thresholds (F7A spec). */
const HIGH_COMPLETION_MIN = 0.8;
const LOW_COMPLETION_MAX = 0.5;
const HIGH_FAILURE_MIN = 0.3;
const HIGH_IGNORE_MIN = 0.3;

/**
 * Deterministic confidence purely from evidenceCount:
 *   >= 20 → 1.0 · >= 10 → 0.75 · >= 5 → 0.5 · otherwise → 0.25
 */
export function deriveLearningConfidence(evidenceCount: number): number {
  if (evidenceCount >= 20) return 1.0;
  if (evidenceCount >= 10) return 0.75;
  if (evidenceCount >= 5) return 0.5;
  return 0.25;
}

/** Internal: build one signal with shared subject/source/confidence fields. */
function signal(
  signalType: LearningSignalType,
  value: number,
  evidenceCount: number,
): LearningSignal {
  return {
    id: `signal:${SUBJECT_ID}:${signalType}`,
    source: 'OUTCOME_REGISTRY',
    signalType,
    subjectType: SUBJECT_TYPE,
    subjectId: SUBJECT_ID,
    value,
    confidence: deriveLearningConfidence(evidenceCount),
    evidenceCount,
  };
}

/**
 * Pure: OutcomeRegistry → LearningSignal[]. Returns [] for an empty registry.
 * Signals are emitted in a fixed, deterministic order; multiple signals can be
 * emitted from the same registry (e.g. LOW_COMPLETION + HIGH_FAILURE).
 */
export function buildLearningSignalsFromOutcomeRegistry(
  registry: OutcomeRegistry,
): LearningSignal[] {
  const summary = summarizeOutcomeRegistry(registry);
  const total = summary.total;

  // No outcomes → no signals. (Also guards every rate divisor below.)
  if (total === 0) return [];

  const completionRate = summary.completionRate; // completed / total (F6A guard)
  const failureRate = summary.failed / total;
  const ignoreRate = summary.ignored / total;

  const signals: LearningSignal[] = [];

  // Fixed emission order for determinism.
  if (completionRate >= HIGH_COMPLETION_MIN) {
    signals.push(signal('HIGH_COMPLETION', completionRate, total));
  }
  if (completionRate < LOW_COMPLETION_MAX) {
    signals.push(signal('LOW_COMPLETION', completionRate, total));
  }
  if (failureRate >= HIGH_FAILURE_MIN) {
    signals.push(signal('HIGH_FAILURE', failureRate, total));
  }
  if (ignoreRate >= HIGH_IGNORE_MIN) {
    signals.push(signal('HIGH_IGNORE', ignoreRate, total));
  }

  return signals;
}
