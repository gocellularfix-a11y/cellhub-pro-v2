// ============================================================
// R-INTELLIGENCE-F5B: deterministic queue approval state transitions.
//
// Models the APPROVAL LIFECYCLE of a QueueItem only. NO execution, NO sending,
// NO persistence, NO UI, NO workers, NO timers, NO PIN logic, NO Date.now(),
// NO randomness. These helpers do NOT call Approval Classification or
// Enforcement — they purely transform queue state.
//
// Purity contract: every helper is pure and never mutates its input. It returns
// a NEW object when the state changes and the SAME reference on a no-op, so
// callers can cheaply detect "did anything change?" via identity.
//
// Reserved-state lifecycle (only these helpers move an item into them):
//   WAITING --approve--> APPROVED (status READY)
//   WAITING --deny-----> DENIED   (status BLOCKED)
//   any     --block----> status BLOCKED (approvalState preserved)
//   DENIED/APPROVED --reset--> WAITING (status PENDING)
// ============================================================

import type { QueueItem } from './QueueItem';

/** Drop optional reason fields from a queue item (immutably). */
function withoutReasons(item: QueueItem): QueueItem {
  if (item.denialReason === undefined && item.blockReason === undefined) return item;
  const { denialReason: _d, blockReason: _b, ...rest } = item;
  return rest;
}

/**
 * Grant approval.
 *  - status BLOCKED        → no-op (must be reset/unblocked first).
 *  - approvalState WAITING → APPROVED + status READY.
 *  - otherwise (NOT_REQUIRED / APPROVED / DENIED) → no-op.
 */
export function approveQueueItem(item: QueueItem): QueueItem {
  if (item.status === 'BLOCKED') return item;
  if (item.approvalState !== 'WAITING') return item;
  return { ...item, approvalState: 'APPROVED', status: 'READY' };
}

/**
 * Deny approval.
 *  - approvalState WAITING → DENIED + status BLOCKED (+ optional denialReason).
 *  - otherwise → no-op.
 */
export function denyQueueItem(item: QueueItem, reason?: string): QueueItem {
  if (item.approvalState !== 'WAITING') return item;
  const next: QueueItem = { ...item, approvalState: 'DENIED', status: 'BLOCKED' };
  if (reason !== undefined) next.denialReason = reason;
  return next;
}

/**
 * Operational block — distinct from approval denial. Sets status BLOCKED and an
 * optional blockReason, PRESERVING approvalState. No-op if already blocked with
 * the identical blockReason.
 */
export function blockQueueItem(item: QueueItem, reason?: string): QueueItem {
  if (item.status === 'BLOCKED' && item.blockReason === reason) return item;
  const next: QueueItem = { ...item, status: 'BLOCKED' };
  if (reason !== undefined) next.blockReason = reason;
  return next;
}

/**
 * Reset the approval dimension back to WAITING.
 *  - DENIED or APPROVED → WAITING + status PENDING (clears denial/block reasons).
 *  - otherwise (NOT_REQUIRED / WAITING) → no-op.
 */
export function resetQueueItemApproval(item: QueueItem): QueueItem {
  if (item.approvalState !== 'DENIED' && item.approvalState !== 'APPROVED') return item;
  return { ...withoutReasons(item), approvalState: 'WAITING', status: 'PENDING' };
}
