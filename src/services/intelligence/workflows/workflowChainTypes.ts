// R-WORKFLOW-CHAIN-V1 — Workflow chain types.
// Separate file to avoid name collision with legacy types.ts
// (WorkflowStep / WorkflowStepKind already defined there for older rounds).
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
