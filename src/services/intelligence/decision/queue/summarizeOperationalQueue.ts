// ============================================================
// R-INTELLIGENCE-F5C: Operational Queue Summary — pure read-only projection.
//
// The first consumer of the Operational Queue. Given QueueItem[], it produces a
// deterministic OperationalQueueSummary the app could later render as "Today's
// Operational Queue". Read-only: NO execution, NO approvals, NO messaging, NO
// persistence, NO UI, NO Date.now(), NO randomness, NO mutation.
//
// Single fused pass over the items (no per-bucket .filter loops) — counts
// status, approval, and type in one traversal.
// ============================================================

import type { PreparedActionType } from '../preparation/PreparedAction';
import type { QueueItem } from './QueueItem';

/** Deterministic operational health of the queue. */
export type QueueHealth = 'HEALTHY' | 'ATTENTION_NEEDED' | 'BLOCKED';

/** Count of queue items per PreparedAction type (all six keys always present). */
export type QueueTypeBreakdown = Record<PreparedActionType, number>;

export interface OperationalQueueSummary {
  // Queue totals.
  totalItems: number;
  readyItems: number;
  pendingItems: number;
  blockedItems: number;
  // Approval totals.
  waitingApproval: number;
  approved: number;
  denied: number;
  notRequired: number;
  // Count by preparation type.
  byType: QueueTypeBreakdown;
  // Deterministic health.
  health: QueueHealth;
}

/** Fresh zeroed type breakdown (all six keys present so callers never see undefined). */
function emptyByType(): QueueTypeBreakdown {
  return {
    READY_PICKUP: 0,
    STALE_REPAIR: 0,
    OVERDUE_LAYAWAY: 0,
    OUTREACH: 0,
    PAYMENT_OPPORTUNITY: 0,
    GENERIC: 0,
  };
}

/**
 * Derive health deterministically:
 *   BLOCKED          if blockedItems > 0
 *   ATTENTION_NEEDED if waitingApproval > 0 OR pendingItems > 0
 *   HEALTHY          otherwise
 */
export function deriveQueueHealth(blockedItems: number, waitingApproval: number, pendingItems: number): QueueHealth {
  if (blockedItems > 0) return 'BLOCKED';
  if (waitingApproval > 0 || pendingItems > 0) return 'ATTENTION_NEEDED';
  return 'HEALTHY';
}

/** Pure: summarize a queue. Same input → same output. Never mutates `items`. */
export function summarizeOperationalQueue(items: QueueItem[]): OperationalQueueSummary {
  const byType = emptyByType();
  let readyItems = 0, pendingItems = 0, blockedItems = 0;
  let waitingApproval = 0, approved = 0, denied = 0, notRequired = 0;

  for (const it of items) {
    switch (it.status) {
      case 'READY': readyItems += 1; break;
      case 'PENDING': pendingItems += 1; break;
      case 'BLOCKED': blockedItems += 1; break;
    }
    switch (it.approvalState) {
      case 'WAITING': waitingApproval += 1; break;
      case 'APPROVED': approved += 1; break;
      case 'DENIED': denied += 1; break;
      case 'NOT_REQUIRED': notRequired += 1; break;
    }
    byType[it.preparedActionType] += 1;
  }

  return {
    totalItems: items.length,
    readyItems,
    pendingItems,
    blockedItems,
    waitingApproval,
    approved,
    denied,
    notRequired,
    byType,
    health: deriveQueueHealth(blockedItems, waitingApproval, pendingItems),
  };
}
