// ============================================================
// R-INTELLIGENCE-F5A: QueueItem canonical model (Execution Queue Foundation).
//
// F5 introduces queue INFRASTRUCTURE only. A QueueItem is the deterministic
// projection of a single PreparedAction (F4A) into "what would be executable
// once approved". It is metadata ONLY — there is NO execution, NO worker, NO
// scheduler, NO customer contact, NO persistence, NO side effects.
//
// The Execution Queue is a PROJECTION, not an executor. Future phases (F5B+)
// will execute from it; F5A only models and builds it.
//
// Identity: a QueueItem's identity is its `id` + `preparedActionId` +
// `sourceTopActionId` — all deterministic, NOT a timestamp. Following the F4A
// determinism patch, `createdAt`/`queuedAt` are OPTIONAL and present only when a
// caller explicitly stamps them, so the default F5A output is byte-identical
// across repeated calls.
// ============================================================

import type { ApprovalKind } from '../approval/types';
import type { PreparedActionType } from '../preparation/PreparedAction';

/**
 * Lifecycle status of a queue item.
 *  - PENDING → waiting on approval before it could become executable.
 *  - READY   → no approval required (or already satisfied); would be executable.
 *  - BLOCKED → cannot proceed (e.g. approval denied). Reserved for F5B+; the F5A
 *              builder never emits it (no real approval decisions exist yet).
 */
export type QueueStatus = 'PENDING' | 'READY' | 'BLOCKED';

/**
 * Approval state of a queue item.
 *  - NOT_REQUIRED → the action needs no approval.
 *  - WAITING      → approval is required and not yet decided.
 *  - APPROVED     → approval granted. Reserved for F5B+ (no emitter in F5A).
 *  - DENIED       → approval refused. Reserved for F5B+ (no emitter in F5A).
 */
export type QueueApprovalState = 'NOT_REQUIRED' | 'WAITING' | 'APPROVED' | 'DENIED';

/**
 * A queued, approval-aware representation of a prepared action. Metadata only —
 * no execution metadata, no retry state, no outcome (all deferred to later phases).
 */
export interface QueueItem {
  /** Deterministic, idempotent: `q:${preparedActionId}`. */
  id: string;
  /** The PreparedAction this item was built from (== `prep:${decisionId}`). */
  preparedActionId: string;
  /** The originating Top Action / decision id (carried through for traceability). */
  sourceTopActionId: string;
  /** Lifecycle status (F5A emits READY or PENDING only). */
  status: QueueStatus;
  /** Approval state (F5A emits NOT_REQUIRED or WAITING only). */
  approvalState: QueueApprovalState;
  /** How approval would be obtained (mirrors the prepared action; not enforced here). */
  approvalKind: ApprovalKind;
  /**
   * Preparation category carried verbatim from the source PreparedAction (F4A).
   * Populated by buildQueueItem from `prepared.type` — never parsed/inferred — so
   * downstream summaries can break down by type without re-ranking or ID parsing.
   */
  preparedActionType: PreparedActionType;
  /**
   * Optional creation timestamp (epoch ms). NOT part of identity. Present only
   * when a caller explicitly stamps it via opts.now; the default F5A pipeline
   * leaves it undefined so output stays deterministic.
   */
  createdAt?: number;
  /** Optional enqueue timestamp (epoch ms). Same optionality rules as createdAt. */
  queuedAt?: number;
  /**
   * Optional reason an approval was DENIED (F5B). Set by denyQueueItem when a
   * reason is supplied; cleared by resetQueueItemApproval. Not part of identity.
   */
  denialReason?: string;
  /**
   * Optional reason for an OPERATIONAL block (F5B) — distinct from approval
   * denial. Set by blockQueueItem when a reason is supplied. Not part of identity.
   */
  blockReason?: string;
}
