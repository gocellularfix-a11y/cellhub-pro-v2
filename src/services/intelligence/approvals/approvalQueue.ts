// R-APPROVAL-QUEUE-V1 — Session-only approval queue.
// No localStorage, no persistence, no async, no side effects outside module.

import type { ApprovalQueueItem } from './types';
import type { ExecutionRequest } from '../executionPipeline/types';

let _queue: ApprovalQueueItem[] = [];

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns a shallow copy of the current queue (never the internal reference). */
export function getApprovalQueue(): ApprovalQueueItem[] {
  return [..._queue];
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Creates an ApprovalQueueItem from an ExecutionRequest.
 *
 * Returns null when request.status !== 'requires_approval' — callers should
 * not enqueue ready or blocked requests.
 *
 * If a pending item with the same id already exists, the existing item is
 * returned (no duplicates).
 */
export function createApprovalQueueItem(params: {
  request: ExecutionRequest;
  requestedByRole?: string;
  reason?: string;
}): ApprovalQueueItem | null {
  const { request, requestedByRole = 'unknown', reason = '' } = params;

  if (request.status !== 'requires_approval') return null;

  const id = `approval-${request.id}`;

  const existing = _queue.find(item => item.id === id && item.status === 'pending');
  if (existing) return { ...existing };

  const now = Date.now();
  const item: ApprovalQueueItem = {
    id,
    request,
    status: 'pending',
    requestedByRole,
    reason,
    createdAt: now,
    updatedAt: now,
  };

  _queue = [..._queue, item];
  return { ...item };
}

/**
 * Transitions a pending item to 'approved'.
 * Returns null when the item is not found or not in pending status.
 */
export function approveQueueItem(id: string): ApprovalQueueItem | null {
  const idx = _queue.findIndex(item => item.id === id && item.status === 'pending');
  if (idx === -1) return null;

  const updated: ApprovalQueueItem = {
    ..._queue[idx],
    status: 'approved',
    updatedAt: Date.now(),
  };

  _queue = [..._queue.slice(0, idx), updated, ..._queue.slice(idx + 1)];
  return { ...updated };
}

/**
 * Transitions a pending item to 'rejected'.
 * Returns null when the item is not found or not in pending status.
 */
export function rejectQueueItem(id: string): ApprovalQueueItem | null {
  const idx = _queue.findIndex(item => item.id === id && item.status === 'pending');
  if (idx === -1) return null;

  const updated: ApprovalQueueItem = {
    ..._queue[idx],
    status: 'rejected',
    updatedAt: Date.now(),
  };

  _queue = [..._queue.slice(0, idx), updated, ..._queue.slice(idx + 1)];
  return { ...updated };
}

/** Wipes the entire queue (e.g. session end / test teardown). */
export function clearApprovalQueue(): void {
  _queue = [];
}
