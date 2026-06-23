// ============================================================
// R-INTELLIGENCE-F5A: deterministic Queue Builder.
//
// Converts ONE PreparedAction (F4A) into a QueueItem. Pure + deterministic:
// same PreparedAction → a byte-identical QueueItem. An optional
// createdAt/queuedAt is stamped ONLY when a caller explicitly passes opts.now.
// NO execution, NO side effects, NO persistence, NO Date.now(), NO randomness.
//
// Status / approval mapping (the entire rule set):
//   approvalRequired === false → status READY,    approvalState NOT_REQUIRED
//   approvalRequired === true  → status PENDING,   approvalState WAITING
//
// APPROVED / DENIED / BLOCKED are reserved for later phases (no real approval
// decision exists at projection time) — this builder never emits them.
// ============================================================

import type { PreparedAction } from '../preparation/PreparedAction';
import type { QueueItem, QueueStatus, QueueApprovalState } from './QueueItem';

export interface BuildQueueItemOptions {
  /**
   * Optional timestamp (epoch ms). When omitted, the QueueItem carries no
   * createdAt/queuedAt and the output is fully deterministic.
   */
  now?: number;
}

/** Pure builder: PreparedAction → QueueItem. */
export function buildQueueItem(
  prepared: PreparedAction,
  opts: BuildQueueItemOptions = {},
): QueueItem {
  const status: QueueStatus = prepared.approvalRequired ? 'PENDING' : 'READY';
  const approvalState: QueueApprovalState = prepared.approvalRequired ? 'WAITING' : 'NOT_REQUIRED';

  const item: QueueItem = {
    id: `q:${prepared.id}`,
    preparedActionId: prepared.id,
    sourceTopActionId: prepared.sourceTopActionId,
    status,
    approvalState,
    approvalKind: prepared.approvalKind,
  };
  // Stamp lifecycle timestamps ONLY when a caller supplies one.
  if (typeof opts.now === 'number') {
    item.createdAt = opts.now;
    item.queuedAt = opts.now;
  }
  return item;
}
