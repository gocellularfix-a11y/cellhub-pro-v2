// R-INTELLIGENCE-OUTCOME-TRACKING-V1
// localStorage-backed operational outcome store.
// Full-replace writes: read → mutate → write. No partial saves.
// Pending outcomes are always kept. Resolved outcomes capped at MAX_DONE.

import type { OperationalOutcome, OutcomeStatus } from './types';
import { generateId } from '@/utils/dates';

export const OUTCOME_STORE_KEY = 'cellhub:operationalOutcomes:v1';

const MAX_DONE = 100; // resolved/failed/unknown outcomes kept in history

// ── Internal persistence ──────────────────────────────────────────────────────

export function readOutcomes(): OperationalOutcome[] {
  try {
    const raw = localStorage.getItem(OUTCOME_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OperationalOutcome[]) : [];
  } catch { return []; }
}

function writeOutcomes(items: OperationalOutcome[]): void {
  try {
    const pending  = items.filter(o => o.status === 'pending');
    const terminal = items
      .filter(o => o.status !== 'pending')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DONE);
    localStorage.setItem(OUTCOME_STORE_KEY, JSON.stringify([...pending, ...terminal]));
  } catch { /* quota / incognito — best-effort */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createOutcome(
  input: Omit<OperationalOutcome, 'id' | 'createdAt' | 'updatedAt'>,
): OperationalOutcome {
  const now = Date.now();
  const item: OperationalOutcome = { ...input, id: generateId(), createdAt: now, updatedAt: now };
  writeOutcomes([...readOutcomes(), item]);
  return item;
}

export function updateOutcome(
  id: string,
  patch: Partial<OperationalOutcome>,
): OperationalOutcome | null {
  const items = readOutcomes();
  const idx = items.findIndex(o => o.id === id);
  if (idx === -1) return null;
  const updated: OperationalOutcome = { ...items[idx], ...patch, id, updatedAt: Date.now() };
  items[idx] = updated;
  writeOutcomes(items);
  return updated;
}

export function completeOutcome(
  id: string,
  status: Exclude<OutcomeStatus, 'pending'>,
  actualSignal?: string,
  revenueImpactCents?: number,
): OperationalOutcome | null {
  const now = Date.now();
  return updateOutcome(id, { status, resolvedAt: now, actualSignal, revenueImpactCents });
}

export function getOutcomes(): OperationalOutcome[] {
  return readOutcomes();
}

export function getPendingOutcomes(): OperationalOutcome[] {
  return readOutcomes().filter(o => o.status === 'pending');
}

export function getOutcomesByWorkflow(workflowId: string): OperationalOutcome[] {
  return readOutcomes().filter(o => o.workflowId === workflowId);
}
