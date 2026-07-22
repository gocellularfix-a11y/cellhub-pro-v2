// CellHub Intelligence — Workflow Continuity Store
// localStorage-backed pending workflow state.
// NEVER auto-confirms, NEVER auto-records revenue — human confirmation required.

import type {
  PendingWorkflow,
  WorkflowType,
  WorkflowStep,
  WorkflowResumeContext,
  ExternalPaymentMetadata,
} from './workflowContinuityTypes';

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

// ── Resume context builder ────────────────────────────────────────────────────

function buildResumeContext(w: PendingWorkflow): WorkflowResumeContext {
  const activeStep = w.steps?.find((s) => s.status === 'active') ?? null;
  const nextStep = w.steps?.find((s) => s.status === 'pending') ?? null;
  const meta = w.metadata as Record<string, unknown>;

  let resumeLabel = 'Resume workflow';
  let resumeDescription = 'Active workflow';

  if (w.type === 'external_payment') {
    const phone = String(meta.phone ?? '');
    const carrier = String(meta.carrier ?? '');
    const lineIndex = typeof meta.lineIndex === 'number' ? meta.lineIndex : undefined;
    const totalLines = typeof meta.totalLines === 'number' ? meta.totalLines : undefined;

    resumeLabel = 'Resume payment workflow';
    resumeDescription = carrier ? `Collecting ${carrier} payment` : 'Collecting carrier payment';
    if (phone) resumeDescription += ` for ${phone}`;
    if (typeof lineIndex === 'number' && typeof totalLines === 'number' && totalLines > 1) {
      resumeDescription += ` · line ${lineIndex + 1} of ${totalLines}`;
    }
  }

  return {
    workflowId: w.id,
    type: w.type,
    currentStepId: activeStep?.id ?? null,
    nextStepId: nextStep?.id ?? null,
    relatedCustomerId: typeof meta.customerId === 'string' ? meta.customerId : null,
    relatedModule: w.type === 'external_payment' ? 'phone-payments' : null,
    resumeLabel,
    resumeDescription,
    metadata: meta,
  };
}

// ── Public API — lifecycle ────────────────────────────────────────────────────

export interface StartWorkflowOptions {
  ttlMs?: number;
  steps?: WorkflowStep[];
}

/** Create and persist a new pending workflow. Returns the created entry. */
export function startWorkflow(
  type: WorkflowType,
  metadata: ExternalPaymentMetadata | Record<string, unknown>,
  options?: StartWorkflowOptions,
): PendingWorkflow {
  const now = Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const workflow: PendingWorkflow = {
    id: `wf-${type}-${now}`,
    type,
    status: 'pending',
    startedAt: now,
    expiresAt: now + ttlMs,
    metadata,
    steps: options?.steps,
  };
  const all = readAll();
  writeAll([...all, workflow]);
  notify();
  return workflow;
}

/**
 * P0-C1 — canonical, IDEMPOTENT entry point for beginning an external
 * phone-payment attempt. If an active (pending, non-expired) external_payment
 * workflow already exists for the same `dedupeKey`, it is REUSED (its TTL is
 * refreshed) and returned — a repeated portal click or a focus return never
 * creates a second pending workflow for the same attempt. A genuinely new
 * attempt (different key, or the prior one already completed/cancelled)
 * creates a fresh workflow. Caller MUST have successfully requested the portal
 * launch BEFORE calling this (no workflow on a failed launch).
 */
export function beginExternalPhonePayment(
  metadata: ExternalPaymentMetadata,
  options?: StartWorkflowOptions,
): PendingWorkflow {
  const key = metadata.dedupeKey;
  if (key) {
    const existing = readAll().find(
      (w) => w.type === 'external_payment' && isActive(w)
        && (w.metadata as ExternalPaymentMetadata).dedupeKey === key,
    );
    if (existing) {
      // Same attempt still pending → reuse it (refresh TTL), never duplicate.
      return resumeWorkflow(existing.id, options?.ttlMs) ?? existing;
    }
  }
  return startWorkflow('external_payment', metadata, options);
}

/**
 * P0-C1 — the MOST RECENTLY STARTED active external_payment workflow (the one
 * the cashier just launched), not the oldest. The bubble resumes THIS one so a
 * lingering older workflow can never hijack the resume card.
 */
export function getMostRecentExternalPaymentWorkflow(): PendingWorkflow | null {
  const active = readAll().filter((w) => w.type === 'external_payment' && isActive(w));
  if (active.length === 0) return null;
  return active.reduce((latest, w) => (w.startedAt > latest.startedAt ? w : latest));
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

/** Mark a workflow expired (auto-cleanup path). */
export function expireWorkflow(id: string): void {
  const all = readAll();
  const idx = all.findIndex((w) => w.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], status: 'expired' };
  writeAll(all);
  notify();
}

// ── Public API — step management ──────────────────────────────────────────────

/** Generic step patch — updates status and/or metadata, stamps updatedAt. */
export function updateWorkflowStep(
  workflowId: string,
  stepId: string,
  patch: Partial<Pick<WorkflowStep, 'status' | 'metadata'>>,
): void {
  const all = readAll();
  const wIdx = all.findIndex((w) => w.id === workflowId);
  if (wIdx === -1) return;
  const w = all[wIdx];
  if (!w.steps) return;
  const sIdx = w.steps.findIndex((s) => s.id === stepId);
  if (sIdx === -1) return;
  const now = Date.now();
  const updatedSteps = [...w.steps];
  updatedSteps[sIdx] = { ...updatedSteps[sIdx], ...patch, updatedAt: now };
  all[wIdx] = { ...w, steps: updatedSteps };
  writeAll(all);
  notify();
}

export function setActiveWorkflowStep(workflowId: string, stepId: string): void {
  updateWorkflowStep(workflowId, stepId, { status: 'active' });
}

export function completeWorkflowStep(workflowId: string, stepId: string): void {
  updateWorkflowStep(workflowId, stepId, { status: 'completed' });
}

export function skipWorkflowStep(workflowId: string, stepId: string): void {
  updateWorkflowStep(workflowId, stepId, { status: 'skipped' });
}

// ── Public API — resume contexts ──────────────────────────────────────────────

/** Resume context for a specific workflow, or null if not active. */
export function getResumeContext(workflowId: string): WorkflowResumeContext | null {
  const w = readAll().find((wf) => wf.id === workflowId);
  if (!w || !isActive(w)) return null;
  return buildResumeContext(w);
}

/** Resume contexts for all currently active workflows. */
export function getPendingResumeContexts(): WorkflowResumeContext[] {
  return readAll().filter(isActive).map(buildResumeContext);
}

/**
 * Highest-priority resume context across all active workflows.
 * Priority: external_payment > any other type.
 */
export function getMostImportantResumeContext(): WorkflowResumeContext | null {
  const active = readAll().filter(isActive);
  // P0-C1: prefer the MOST RECENTLY STARTED external payment (the one just
  // launched) — never blindly the oldest record.
  const extPayment = getMostRecentExternalPaymentWorkflow();
  if (extPayment) return buildResumeContext(extPayment);
  if (active.length > 0) return buildResumeContext(active[0]);
  return null;
}

// ── Public API — queries ──────────────────────────────────────────────────────

/** All currently active (pending + not expired) workflows. */
export function getPendingWorkflows(): PendingWorkflow[] {
  return readAll().filter(isActive);
}

/**
 * The CURRENT active external_payment workflow, or null. P0-C1: this is the
 * MOST RECENTLY STARTED one (the attempt the cashier just launched) — never
 * blindly the oldest lingering record.
 */
export function getPendingExternalPaymentWorkflow(): PendingWorkflow | null {
  return getMostRecentExternalPaymentWorkflow();
}

/** P0-C1b — raw record by id (ANY status), for exact-resume validation. */
export function getWorkflowById(id: string): PendingWorkflow | null {
  return readAll().find((w) => w.id === id) ?? null;
}
