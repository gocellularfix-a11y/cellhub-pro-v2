// R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1
// localStorage-backed operational workflow store.
// Full-replace writes: read → mutate → write. No partial saves.
// Active workflows are always kept. Completed/cancelled are capped at MAX_DONE.

import type { OperationalWorkflow, WorkflowStatus } from './types';
import { generateId } from '@/utils/dates';

export const WORKFLOW_STORE_KEY = 'cellhub:operationalWorkflows:v1';

const MAX_DONE = 30; // cap on completed/cancelled workflows in history

// ── Internal persistence ──────────────────────────────────────────────────────

export function readWorkflows(): OperationalWorkflow[] {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OperationalWorkflow[]) : [];
  } catch { return []; }
}

function writeWorkflows(items: OperationalWorkflow[]): void {
  try {
    const active = items.filter(w => w.status !== 'completed' && w.status !== 'cancelled');
    const done   = items
      .filter(w => w.status === 'completed' || w.status === 'cancelled')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DONE);
    localStorage.setItem(WORKFLOW_STORE_KEY, JSON.stringify([...active, ...done]));
  } catch { /* quota / incognito — best-effort */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createWorkflow(
  input: Omit<OperationalWorkflow, 'id' | 'createdAt' | 'updatedAt'>,
): OperationalWorkflow {
  const now = Date.now();
  const item: OperationalWorkflow = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  writeWorkflows([...readWorkflows(), item]);
  return item;
}

export function updateWorkflow(
  id: string,
  patch: Partial<OperationalWorkflow>,
): OperationalWorkflow | null {
  const items = readWorkflows();
  const idx = items.findIndex(w => w.id === id);
  if (idx === -1) return null;
  const updated: OperationalWorkflow = {
    ...items[idx],
    ...patch,
    id,               // never overwrite id
    updatedAt: Date.now(),
  };
  items[idx] = updated;
  writeWorkflows(items);
  return updated;
}

export function completeWorkflow(id: string): OperationalWorkflow | null {
  return updateWorkflow(id, { status: 'completed', completedAt: Date.now() });
}

export function getActiveWorkflows(): OperationalWorkflow[] {
  return readWorkflows().filter(
    w => w.status !== 'completed' && w.status !== 'cancelled',
  );
}

// Returns the first active (non-completed, non-cancelled) workflow for a given
// entity. If the entity has multiple workflows, the most recently updated is returned.
export function getWorkflowByEntity(
  entityType: string,
  entityId: string,
): OperationalWorkflow | null {
  const candidates = readWorkflows()
    .filter(
      w =>
        w.entityType === entityType &&
        w.entityId === entityId &&
        w.status !== 'completed' &&
        w.status !== 'cancelled',
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0] ?? null;
}

// R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: returns active workflows whose
// updatedAt is older than thresholdMs — used to surface stalled workflows.
export function getStaleWorkflows(thresholdMs: number): OperationalWorkflow[] {
  const cutoff = Date.now() - thresholdMs;
  return readWorkflows().filter(
    w => w.status !== 'completed' && w.status !== 'cancelled' && w.updatedAt < cutoff,
  );
}

// ── Terminal status helpers ───────────────────────────────────────────────────
// Used by future cross-device sync and Companion updates.

export function cancelWorkflow(id: string): OperationalWorkflow | null {
  return updateWorkflow(id, { status: 'cancelled' as WorkflowStatus });
}
