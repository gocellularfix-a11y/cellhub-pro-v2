// R-APPROVAL-QUEUE-V1 — Approval queue types.
// Session-only; no persistence, no cloud, no UI yet.

import type { ExecutionRequest } from '../executionPipeline/types';

export type ApprovalQueueStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

export type ApprovalQueueItem = {
  /** Deterministic ID: approval-{request.id} */
  id: string;
  request: ExecutionRequest;
  status: ApprovalQueueStatus;
  requestedByRole: string;
  reason: string;
  createdAt: number;
  updatedAt: number;
};
