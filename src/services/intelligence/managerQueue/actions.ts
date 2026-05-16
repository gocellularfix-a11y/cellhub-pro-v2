// R-INTELLIGENCE-MANAGER-QUEUE-V1 + R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1
// Public action API for the manager queue.
// Callers import from here — never from store.ts directly.

import type { ManagerQueueItem, QueueItemStatus, QueueItemSeverity, QueueItemCategory, QueueEntityType } from './types';
import { SEVERITY_RANK } from './selectors';
import { readQueue, writeQueue } from './store';
import { generateId } from '@/utils/dates';

export type { ManagerQueueItem, QueueItemStatus, QueueItemSeverity, QueueItemCategory, QueueEntityType };
export { readQueue as getQueue };

// ── Fingerprint ───────────────────────────────────────────────────
// Deterministic dedup key: category|entityType|entityId|normalizedTitle
// Stable — same operational problem always produces the same fingerprint
// regardless of when it fires or what description was passed.

export function buildFingerprint(
  category: QueueItemCategory,
  entityType: QueueEntityType | undefined,
  entityId: string | undefined,
  title: string,
): string {
  const normalizedTitle = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 48);
  return `${category}|${entityType ?? ''}|${entityId ?? ''}|${normalizedTitle}`;
}

// ── Severity escalation ───────────────────────────────────────────
// Repeated issues rise in urgency. Thresholds are deterministic —
// no randomness, no AI. Only escalates, never de-escalates.
//   occurrences ≥ 3 → at least medium
//   occurrences ≥ 5 → at least high
//   occurrences ≥ 8 → critical

const ESCALATION: Array<[number, QueueItemSeverity]> = [
  [8, 'critical'],
  [5, 'high'],
  [3, 'medium'],
];

function escalateSeverity(current: QueueItemSeverity, occurrenceCount: number): QueueItemSeverity {
  const currentRank = SEVERITY_RANK[current];
  for (const [threshold, candidate] of ESCALATION) {
    if (occurrenceCount >= threshold && SEVERITY_RANK[candidate] > currentRank) {
      return candidate;
    }
  }
  return current;
}

// ── Add ──────────────────────────────────────────────────────────

export interface NewQueueItemInput {
  severity: QueueItemSeverity;
  category: QueueItemCategory;
  title: string;
  description: string;
  entityType?: QueueEntityType;
  entityId?: string;
  recommendedAction?: string;
  notes?: string;
  // R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1: optional workflow link.
  // Callers create/ensure a workflow via ensureOperationalWorkflow() first,
  // then pass the returned id here to link item ↔ workflow.
  workflowId?: string;
}

export function addManagerQueueItem(input: NewQueueItemInput): ManagerQueueItem {
  const now = Date.now();
  const fingerprint = buildFingerprint(input.category, input.entityType, input.entityId, input.title);
  const items = readQueue();

  // Dedup: find a pending item with the same fingerprint.
  // O(n) single scan — queue is expected < 200 items.
  const existingIdx = items.findIndex(
    i => i.fingerprint === fingerprint && i.status === 'pending',
  );

  if (existingIdx !== -1) {
    const existing = items[existingIdx];
    const newCount = (existing.occurrenceCount ?? 1) + 1;
    items[existingIdx] = {
      ...existing,
      occurrenceCount: newCount,
      lastSeenAt: now,
      updatedAt: now,
      // Escalate severity on repeat — only upward, never down.
      severity: escalateSeverity(existing.severity, newCount),
      // Refresh description to the latest observation.
      description: input.description,
      // Fill recommendedAction if the existing item had none.
      recommendedAction: existing.recommendedAction || input.recommendedAction,
    };
    writeQueue(items);
    return items[existingIdx];
  }

  // New item — create with full dedup metadata.
  const item: ManagerQueueItem = {
    id: generateId(),
    fingerprint,
    status: 'pending',
    severity: input.severity,
    category: input.category,
    title: input.title,
    description: input.description,
    entityType: input.entityType,
    entityId: input.entityId,
    recommendedAction: input.recommendedAction,
    notes: input.notes,
    workflowId: input.workflowId,
    occurrenceCount: 1,
    createdAt: now,
    updatedAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  writeQueue([...items, item]);
  return item;
}

// ── Status transitions ───────────────────────────────────────────

function setStatus(id: string, status: QueueItemStatus, notes?: string): void {
  const items = readQueue();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  const now = Date.now();
  items[idx] = {
    ...items[idx],
    status,
    updatedAt: now,
    resolvedAt: status !== 'pending' ? now : items[idx].resolvedAt,
    ...(notes !== undefined ? { notes } : {}),
  };
  writeQueue(items);
}

export function approveQueueItem(id: string, notes?: string): void  { setStatus(id, 'approved',  notes); }
export function dismissQueueItem(id: string, notes?: string): void  { setStatus(id, 'dismissed', notes); }
export function resolveQueueItem(id: string, notes?: string): void  { setStatus(id, 'resolved',  notes); }

// R-INTELLIGENCE-AUTO-RESOLUTION-V1: silent system-driven resolution.
// Appends an auto-note to the item's notes history so the operator can
// see WHY it was resolved without any popup or notification.
export function autoResolveQueueItem(id: string, reason: string): void {
  const items = readQueue();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  const existing = items[idx];
  const autoNote = `Auto-resolved: ${reason}`;
  const notes = existing.notes ? `${existing.notes}\n${autoNote}` : autoNote;
  const now = Date.now();
  items[idx] = {
    ...existing,
    status: 'resolved',
    updatedAt: now,
    resolvedAt: now,
    notes,
  };
  writeQueue(items);
}

// R-INTELLIGENCE-FEEDBACK-LOOP-V1: snooze — hides item from pending view
// for durationMs (default 1 hour). Item reappears automatically when
// snoozedUntil expires. Status stays 'pending' — this is NOT a resolution.
export function snoozeQueueItem(id: string, durationMs = 3_600_000): void {
  const items = readQueue();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  items[idx] = { ...items[idx], snoozedUntil: Date.now() + durationMs, updatedAt: Date.now() };
  writeQueue(items);
}
