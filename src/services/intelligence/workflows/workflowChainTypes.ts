// OPERATIONAL WORKFLOW CHAIN TYPES
// NOT interchangeable with legacy WorkflowStep types in ./types.ts
// Separate intentionally to avoid breaking older workflow engine paths.
//
// R-WORKFLOW-CHAIN-V1 — Workflow chain types.
// Session-only; no persistence, no cloud, no UI yet.

import type { ExecutionRequest } from '../executionPipeline/types';
import type { ApprovalQueueItem } from '../approvals/types';

export type WorkflowChainStatus =
  | 'draft'
  | 'ready'
  | 'waiting_approval'
  | 'completed'
  | 'blocked';

export type WorkflowChainStepStatus =
  | 'pending'
  | 'ready'
  | 'waiting_approval'
  | 'completed'
  | 'blocked';

export type WorkflowChainStepKind =
  | 'execution_request'
  | 'approval_request'
  | 'timeline_note'
  | 'follow_up';

export type WorkflowChainStep = {
  id: string;
  kind: WorkflowChainStepKind;
  status: WorkflowChainStepStatus;
  titleKey: string;
  executionRequest?: ExecutionRequest;
  approvalItem?: ApprovalQueueItem;
  // R-WORKFLOW-APPROVAL-LINKAGE-V1 — immutable snapshot fields for workflow lookup/debugging
  // These fields are treated as immutable snapshots captured at workflow-step creation time.
  // They are NOT guaranteed to stay synchronized with nested live objects after creation.
  approvalId?: string;
  requestId?: string;
  actionKey?: string;
  entityType?: string;
  entityId?: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowChain = {
  id: string;
  titleKey: string;
  status: WorkflowChainStatus;
  steps: WorkflowChainStep[];
  createdAt: number;
  updatedAt: number;
};

// ── R-WORKFLOW-TRANSITIONS-V1 ─────────────────────────────────────────────────

export type WorkflowTransitionReason =
  | 'step_completed'
  | 'step_blocked'
  | 'approval_received'
  | 'manual_update'
  | 'system_sync';

export type WorkflowTransition = {
  id: string;
  workflowId: string;
  fromStatus: WorkflowChainStatus;
  toStatus: WorkflowChainStatus;
  reason: WorkflowTransitionReason;
  createdAt: number;
};
