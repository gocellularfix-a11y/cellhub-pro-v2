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

// ── R-WORKFLOW-CONTINUATION-PRIMITIVES-V1 ────────────────────────────────────

export type WorkflowContinuationKind =
  | 'after_step_completed'
  | 'after_step_blocked'
  | 'after_approval_received'
  | 'manual';

export type WorkflowContinuation = {
  /** Deterministic: continuation-{workflowId}-{fromStepId}-{toStepId}-{kind} */
  id: string;
  workflowId: string;
  fromStepId: string;
  toStepId: string;
  kind: WorkflowContinuationKind;
  createdAt: number;
};

// ── R-WORKFLOW-DEPENDENCY-GRAPH-V1 ───────────────────────────────────────────

export type WorkflowDependencyKind =
  | 'requires_completion'
  | 'requires_approval'
  | 'requires_manual_action'
  | 'blocks_until_resolved';

export type WorkflowDependency = {
  /** Deterministic: dependency-{workflowId}-{fromStepId}-{dependsOnStepId}-{kind} */
  id: string;
  workflowId: string;
  fromStepId: string;
  dependsOnStepId: string;
  kind: WorkflowDependencyKind;
  createdAt: number;
};

// ── R-WORKFLOW-READINESS-EVALUATION-V1 ───────────────────────────────────────

export type WorkflowReadinessResult = {
  workflowId: string;
  readyStepIds: string[];
  blockedStepIds: string[];
  waitingApprovalStepIds: string[];
  completedStepIds: string[];
};

// ── R-WORKFLOW-READINESS-GRAPH-INTEGRATION-V1 ────────────────────────────────

export type WorkflowGraphReadinessResult = WorkflowReadinessResult & {
  /** Ready steps that have at least one unresolved dependency in the graph. */
  dependencyBlockedStepIds: string[];
  /** Ready steps whose dependency graph is fully satisfied (or has no dependencies). */
  dependencyReadyStepIds: string[];
};

// ── R-WORKFLOW-TRANSITIONS-V1 ─────────────────────────────────────────────────

export type WorkflowTransitionReason =
  | 'step_completed'
  | 'step_blocked'
  | 'approval_received'
  | 'manual_update'
  | 'system_sync';

export type WorkflowTransition = {
  /** `${key}-${sequence}` */
  id: string;
  /** Deterministic semantic key: transition-{workflowId}-{from}-{to}-{reason} */
  key: string;
  /** Session-local monotonic occurrence counter. Resets on clearWorkflowTransitions(). */
  sequence: number;
  workflowId: string;
  fromStatus: WorkflowChainStatus;
  toStatus: WorkflowChainStatus;
  reason: WorkflowTransitionReason;
  /** Occurrence timestamp only — NOT part of identity. */
  createdAt: number;
};
