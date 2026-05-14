// CellHub Intelligence — Workflow Continuity Types
// Pure TypeScript types — no React, no DOM, no I/O.

export type WorkflowType = 'external_payment';

export type WorkflowStatus = 'pending' | 'completed' | 'cancelled' | 'expired';

export interface ExternalPaymentMetadata {
  phone: string;
  carrier: string;
  amountCents: number;
}

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
}

export interface WorkflowConfirmationSignal {
  hasPending: boolean;
  pendingWorkflow: PendingWorkflow | null;
  returnDetected: boolean;
}
