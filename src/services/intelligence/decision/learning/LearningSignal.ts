// ============================================================
// R-INTELLIGENCE-F7A: LearningSignal canonical model (Learning Signals).
//
// F7A OBSERVES historical outcomes and emits read-only signals. It does NOT
// change ranking, does NOT change scoring, does NOT alter priorities, does NOT
// adapt behavior, and does NOT persist memory. A LearningSignal is a pure,
// deterministic statement about what the OutcomeRegistry shows — nothing acts
// on it yet.
//
// Identity is deterministic (`signal:${subjectId}:${signalType}`) and carries
// NO timestamp. Same registry → byte-identical signals.
// ============================================================

/**
 * Where the signal was derived from. F7A only reads the OutcomeRegistry, so
 * there is exactly one source for now — kept as a named type so future phases
 * can add sources without reshaping the model.
 */
export type LearningSignalSource = 'OUTCOME_REGISTRY';

/**
 * The kind of observation a signal carries. Each is a deterministic threshold
 * crossing over the registry's aggregate rates:
 *  - HIGH_COMPLETION → completionRate is strong (>= 0.80).
 *  - LOW_COMPLETION  → completionRate is weak (< 0.50).
 *  - HIGH_FAILURE    → failed / total is elevated (>= 0.30).
 *  - HIGH_IGNORE     → ignored / total is elevated (>= 0.30).
 */
export type LearningSignalType =
  | 'HIGH_COMPLETION'
  | 'LOW_COMPLETION'
  | 'HIGH_FAILURE'
  | 'HIGH_IGNORE';

/**
 * The thing a signal is about. F7A is GLOBAL-only: no per-customer and no
 * per-action-type learning, and no inference of subjects from ids or text.
 */
export type LearningSubjectType = 'GLOBAL';

/** A single deterministic, read-only learning observation. */
export interface LearningSignal {
  /** Deterministic, idempotent: `signal:${subjectId}:${signalType}`. */
  id: string;
  /** Where it was derived from (F7A: always 'OUTCOME_REGISTRY'). */
  source: LearningSignalSource;
  /** Which threshold was crossed. */
  signalType: LearningSignalType;
  /** Subject scope (F7A: always 'GLOBAL'). */
  subjectType: LearningSubjectType;
  /** Subject id (F7A: always 'global'). */
  subjectId: string;
  /** The rate that triggered the signal (e.g. completionRate / failureRate). */
  value: number;
  /** Deterministic confidence derived purely from evidenceCount. */
  confidence: number;
  /** Number of outcomes the signal was computed over (== registry total). */
  evidenceCount: number;
}
