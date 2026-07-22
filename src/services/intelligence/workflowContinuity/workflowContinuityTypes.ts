// CellHub Intelligence — Workflow Continuity Types
// Pure TypeScript types — no React, no DOM, no I/O.

export type WorkflowType = 'external_payment';

export type WorkflowStatus = 'pending' | 'completed' | 'cancelled' | 'expired';

// ── Step model ────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

// ── Metadata shapes ───────────────────────────────────────────────────────────

export interface ExternalPaymentMetadata {
  phone: string;
  carrier: string;
  amountCents: number;
  /** Same as phone — canonical active line for the portal session. */
  activeLine: string;
  /** 0-based index of this line in the runner's selected set. */
  lineIndex: number;
  /** Total selected lines in the runner session. */
  totalLines: number;
  /** Originating module — 'phone_payments'. */
  source: string;
  /** Optional runner session identifier for deduplication. */
  runnerSessionId?: string;
  /** P0-C1: customer this payment belongs to (was read untyped before). */
  customerId?: string;
  /** P0-C1: the resolved portal that was actually launched (parity + resume). */
  portalId?: string;
  /** P0-C1: the launched portal URL (frozen at launch, for resume). */
  portalUrl?: string;
  /** P0-C1: deterministic idempotency key for ONE attempt — see
   *  paymentAttemptKey(). Dedupes duplicate launches/returns for the same
   *  still-pending attempt. */
  dedupeKey?: string;
}

// ── Workflow record ───────────────────────────────────────────────────────────

export interface PendingWorkflow {
  id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  /** ms epoch — when startWorkflow() was called */
  startedAt: number;
  /** ms epoch — auto-expire after TTL */
  expiresAt: number;
  completedAt?: number;
  cancelledAt?: number;
  metadata: ExternalPaymentMetadata | Record<string, unknown>;
  steps?: WorkflowStep[];
}

// ── Resume context ────────────────────────────────────────────────────────────

/**
 * Derived view of an active workflow for the bubble's resume card.
 * Built by getResumeContext() — never stored directly.
 */
export interface WorkflowResumeContext {
  workflowId: string;
  type: WorkflowType;
  currentStepId: string | null;
  nextStepId: string | null;
  relatedCustomerId: string | null;
  relatedModule: string | null;
  /** Short label for the card header (English). */
  resumeLabel: string;
  /** One-line description of what was in progress (English). */
  resumeDescription: string;
  metadata: Record<string, unknown>;
}

// ── Confirmation signal (legacy compat) ───────────────────────────────────────

export interface WorkflowConfirmationSignal {
  hasPending: boolean;
  pendingWorkflow: PendingWorkflow | null;
  returnDetected: boolean;
}
