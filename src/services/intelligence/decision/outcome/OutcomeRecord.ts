// ============================================================
// R-INTELLIGENCE-F6A: OutcomeRecord canonical model (Outcome Tracking).
//
// F6 records WHAT HAPPENED to a queued action. F6A is models only: it does NOT
// evaluate performance, does NOT learn, does NOT score, does NOT rank, does NOT
// execute or persist. It only represents an outcome the caller explicitly states.
//
// Identity is deterministic (`outcome:${queueItemId}`) and carries no timestamp.
// ============================================================

/**
 * Terminal outcome of a queued action, supplied EXPLICITLY by the caller — there
 * is no automatic success inference anywhere in F6A.
 *  - COMPLETED → the action was carried out successfully.
 *  - FAILED    → it was attempted but did not succeed.
 *  - CANCELLED → it was deliberately called off before completion.
 *  - IGNORED   → it was never acted on.
 */
export type OutcomeStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'IGNORED';

/** The four allowed statuses, for runtime validation in the builder. */
export const OUTCOME_STATUSES: readonly OutcomeStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'IGNORED',
];

/**
 * A recorded outcome for a single QueueItem. Metadata only — no timestamps, no
 * execution metadata, no learning signals.
 */
export interface OutcomeRecord {
  /** Deterministic, idempotent: `outcome:${queueItemId}`. */
  id: string;
  /** The QueueItem this outcome is about (== `q:${preparedActionId}`). */
  queueItemId: string;
  /** The PreparedAction the queue item came from (carried through for traceability). */
  preparedActionId: string;
  /** The originating Top Action / decision id (carried through for traceability). */
  sourceTopActionId: string;
  /** Caller-supplied terminal status. */
  outcomeStatus: OutcomeStatus;
  /** Optional short reason (e.g. why it failed/cancelled). Not part of identity. */
  reason?: string;
  /** Optional free-form notes. Not part of identity. */
  notes?: string;
}
