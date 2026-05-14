// CellHub Intelligence — Workflow Continuity Store
// localStorage-backed pending workflow state.
// NEVER auto-confirms, NEVER auto-records revenue — human confirmation required.

import type { PendingWorkflow, WorkflowType, ExternalPaymentMetadata } from './workflowContinuityTypes';

const STORE_KEY = 'cellhub:intelligence:workflowContinuity:v1';
const MAX_WORKFLOWS = 50;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ── Pub/sub ───────────────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => { try { l(); } catch { /* never block callers */ } });
}

export function subscribeWorkflowContinuity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── localStorage I/O ──────────────────────────────────────────────────────────

function readAll(): PendingWorkflow[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingWorkflow[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: PendingWorkflow[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = items.length > MAX_WORKFLOWS ? items.slice(items.length - MAX_WORKFLOWS) : items;
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch { /* quota / serialization — non-fatal */ }
}

// ── Status helpers ────────────────────────────────────────────────────────────

function isActive(w: PendingWorkflow): boolean {
  return w.status === 'pending' && Date.now() < w.expiresAt;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create and persist a new pending workflow. Returns the created entry. */
export function startWorkflow(
  type: WorkflowType,
  metadata: ExternalPaymentMetadata | Record<string, unknown>,
  ttlMs: number = DEFAULT_TTL_MS,
): PendingWorkflow {
  const now = Date.now();
  const workflow: PendingWorkflow = {
    id: `wf-${type}-${now}`,
    type,
    status: 'pending',
    startedAt: now,
    expiresAt: now + ttlMs,
    metadata,
  };
  const all = readAll();
  writeAll([...all, workflow]);
  notify();
  return workflow;
}

/** Reset expiry on an existing pending workflow (extend TTL). */
export function resumeWorkflow(id: string, ttlMs: number = DEFAULT_TTL_MS): PendingWorkflow | null {
  const all = readAll();
  const idx = all.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  const updated = { ...all[idx], expiresAt: Date.now() + ttlMs };
  all[idx] = updated;
  writeAll(all);
  notify();
  return updated;
}

/** Mark a workflow completed (human has confirmed the external action). */
export function completeWorkflow(id: string): void {
  const all = readAll();
  const idx = all.findIndex((w) => w.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], status: 'completed', completedAt: Date.now() };
  writeAll(all);
  notify();
}

/** Cancel a pending workflow (cashier chose "Cancel"). */
export function cancelWorkflow(id: string): void {
  const all = readAll();
  const idx = all.findIndex((w) => w.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], status: 'cancelled', cancelledAt: Date.now() };
  writeAll(all);
  notify();
}

/** Mark an expired workflow (auto-cleanup path). */
export function expireWorkflow(id: string): void {
  const all = readAll();
  const idx = all.findIndex((w) => w.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], status: 'expired' };
  writeAll(all);
  notify();
}

/** All currently active (pending + not expired) workflows. */
export function getPendingWorkflows(): PendingWorkflow[] {
  return readAll().filter(isActive);
}

/** The first active external_payment workflow, or null. */
export function getPendingExternalPaymentWorkflow(): PendingWorkflow | null {
  return readAll().find((w) => w.type === 'external_payment' && isActive(w)) ?? null;
}
