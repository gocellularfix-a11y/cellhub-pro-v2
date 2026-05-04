// ============================================================
// CellHub Intelligence — Outreach Action Queue
// R-INTEL-AUTO-ACTION-QUEUE
//
// Persistent queue of actionable outreach tasks (WhatsApp messages, tasks)
// surfaced by the intelligence engine. Owner-facing only — no auto-send.
// Pure compute + localStorage; no React, no external APIs.
//
// Dedup: an item with the same (customerId, type) tuple created within the
// last 24h is treated as a duplicate and silently skipped. This keeps the
// queue idempotent across repeated engine.refresh() calls (one per chat
// query) without growing unbounded.
//
// Priority: higher = more urgent. The producer (IntelligenceEngine) bakes
// "high-value customer first" + "inactivity > 14 days" boosts directly into
// the priority value before enqueue. This module just sorts by it.
// ============================================================

import type { ActionQueueItem } from './types';

const QUEUE_KEY = 'cellhub_intel_action_queue';
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function readQueue(): ActionQueueItem[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActionQueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: ActionQueueItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Quota / serialization failure — non-fatal, queue is best-effort.
  }
}

/** Read the persisted queue (sorted by priority desc on write). */
export function getOutreachQueue(): ActionQueueItem[] {
  return readQueue();
}

/** Wipe the queue. Manual maintenance — not called automatically. */
export function clearOutreachQueue(): void {
  writeQueue([]);
}

/**
 * Append candidates to the queue, deduping by (customerId, type) within
 * the last 24h. Items without a customerId pass through (e.g. generic
 * 'task' entries with no customer target). Final queue is sorted by
 * priority desc. Returns the items actually inserted (skipped duplicates
 * omitted) so callers can count what they queued this run.
 */
export function enqueueOutreachActions(
  candidates: ActionQueueItem[],
): ActionQueueItem[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const queue = readQueue();
  const now = Date.now();
  const inserted: ActionQueueItem[] = [];

  for (const c of candidates) {
    if (c.customerId) {
      const dup = queue.find((q) =>
        q.customerId === c.customerId
        && q.type === c.type
        && (now - (q.createdAt || 0)) < DEDUP_WINDOW_MS,
      );
      if (dup) continue;
    }
    queue.push(c);
    inserted.push(c);
  }

  if (inserted.length === 0) return [];

  queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  writeQueue(queue);
  return inserted;
}
