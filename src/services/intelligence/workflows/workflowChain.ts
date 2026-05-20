// R-WORKFLOW-CHAIN-V1 — Session-only workflow chain storage.
// No localStorage, no persistence, no async, no cloud, no automatic execution.

// TODO: Future integrations —
//   - convert ExecutionRequest into workflow chain step
//   - convert ApprovalQueueItem into workflow chain step
//   - surface chain in timeline / Companion feed

import type {
  WorkflowChain,
  WorkflowChainStatus,
  WorkflowChainStep,
  WorkflowChainStepKind,
  WorkflowChainStepStatus,
} from './workflowChainTypes';
import type { ExecutionRequest } from '../executionPipeline/types';
import type { ApprovalQueueItem } from '../approvals/types';
import { publishOperatorEvent } from '../events/operatorEventBus';

const MAX_CHAINS = 100;

let _chains: WorkflowChain[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveChainStatus(steps: WorkflowChainStep[]): WorkflowChainStatus {
  if (steps.some(s => s.status === 'blocked'))           return 'blocked';
  if (steps.some(s => s.status === 'waiting_approval'))  return 'waiting_approval';
  if (steps.length > 0 && steps.every(s => s.status === 'completed')) return 'completed';
  if (steps.some(s => s.status === 'ready'))             return 'ready';
  return 'draft';
}

export function createWorkflowChainStep(params: {
  id: string;
  kind: WorkflowChainStepKind;
  status: WorkflowChainStepStatus;
  titleKey: string;
  executionRequest?: ExecutionRequest;
  approvalItem?: ApprovalQueueItem;
}): WorkflowChainStep {
  const now = Date.now();
  return {
    id: params.id,
    kind: params.kind,
    status: params.status,
    titleKey: params.titleKey,
    ...(params.executionRequest !== undefined && { executionRequest: params.executionRequest }),
    ...(params.approvalItem !== undefined     && { approvalItem: params.approvalItem }),
    createdAt: now,
    updatedAt: now,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Creates or replaces a workflow chain by id.
 * If a chain with the same id already exists it is replaced in-place.
 * When total chains exceed MAX_CHAINS the oldest (by insertion order) are dropped.
 */
export function createWorkflowChain(params: {
  id: string;
  titleKey: string;
  steps?: WorkflowChainStep[];
}): WorkflowChain {
  const steps = params.steps ?? [];
  const now = Date.now();
  const chain: WorkflowChain = {
    id: params.id,
    titleKey: params.titleKey,
    status: deriveChainStatus(steps),
    steps,
    createdAt: now,
    updatedAt: now,
  };

  const existingIdx = _chains.findIndex(c => c.id === params.id);
  if (existingIdx !== -1) {
    _chains = [
      ..._chains.slice(0, existingIdx),
      chain,
      ..._chains.slice(existingIdx + 1),
    ];
  } else {
    const next = [..._chains, chain];
    _chains = next.length > MAX_CHAINS ? next.slice(next.length - MAX_CHAINS) : next;
  }

  publishOperatorEvent({
    id: `workflow-created-${chain.id}`,
    type: 'workflow_created',
    source: 'intelligence',
    severity: 'info',
    workflowId: chain.id,
    workflowStatus: chain.status,
  });

  return { ...chain, steps: [...chain.steps] };
}

/** Appends a step to an existing chain and re-derives chain status. */
export function addWorkflowChainStep(chainId: string, step: WorkflowChainStep): WorkflowChain | null {
  const idx = _chains.findIndex(c => c.id === chainId);
  if (idx === -1) return null;

  const prev = _chains[idx];
  const steps = [...prev.steps, step];
  const updated: WorkflowChain = {
    ...prev,
    steps,
    status: deriveChainStatus(steps),
    updatedAt: Date.now(),
  };

  _chains = [..._chains.slice(0, idx), updated, ..._chains.slice(idx + 1)];

  publishOperatorEvent({
    id: `workflow-step-added-${chainId}-${step.id}`,
    type: 'workflow_step_added',
    source: 'intelligence',
    severity: 'info',
    workflowId: chainId,
    workflowStatus: updated.status,
    stepId: step.id,
    stepKind: step.kind,
    stepStatus: step.status,
  });

  publishOperatorEvent({
    id: `workflow-updated-${chainId}`,
    type: 'workflow_updated',
    source: 'intelligence',
    severity: 'info',
    workflowId: chainId,
    workflowStatus: updated.status,
  });

  if (updated.status === 'completed') {
    publishOperatorEvent({
      id: `workflow-completed-${chainId}`,
      type: 'workflow_completed',
      source: 'intelligence',
      severity: 'success',
      workflowId: chainId,
      workflowStatus: updated.status,
    });
  } else if (updated.status === 'blocked') {
    publishOperatorEvent({
      id: `workflow-blocked-${chainId}`,
      type: 'workflow_blocked',
      source: 'intelligence',
      severity: 'warning',
      workflowId: chainId,
      workflowStatus: updated.status,
    });
  }

  return { ...updated, steps: [...updated.steps] };
}

/** Transitions one step's status and re-derives chain status. */
export function updateWorkflowChainStepStatus(params: {
  chainId: string;
  stepId: string;
  status: WorkflowChainStepStatus;
}): WorkflowChain | null {
  const chainIdx = _chains.findIndex(c => c.id === params.chainId);
  if (chainIdx === -1) return null;

  const prev = _chains[chainIdx];
  const stepIdx = prev.steps.findIndex(s => s.id === params.stepId);
  if (stepIdx === -1) return null;

  const now = Date.now();
  const updatedStep: WorkflowChainStep = {
    ...prev.steps[stepIdx],
    status: params.status,
    updatedAt: now,
  };
  const steps = [
    ...prev.steps.slice(0, stepIdx),
    updatedStep,
    ...prev.steps.slice(stepIdx + 1),
  ];
  const updated: WorkflowChain = {
    ...prev,
    steps,
    status: deriveChainStatus(steps),
    updatedAt: now,
  };

  _chains = [..._chains.slice(0, chainIdx), updated, ..._chains.slice(chainIdx + 1)];

  const stepSeverity =
    params.status === 'completed' ? 'success' :
    params.status === 'blocked'   ? 'warning' :
    'info';

  publishOperatorEvent({
    id: `workflow-step-updated-${params.chainId}-${params.stepId}`,
    type: 'workflow_step_updated',
    source: 'intelligence',
    severity: stepSeverity,
    workflowId: params.chainId,
    workflowStatus: updated.status,
    stepId: params.stepId,
    stepKind: updatedStep.kind,
    stepStatus: params.status,
  });

  publishOperatorEvent({
    id: `workflow-updated-${params.chainId}`,
    type: 'workflow_updated',
    source: 'intelligence',
    severity: 'info',
    workflowId: params.chainId,
    workflowStatus: updated.status,
  });

  if (updated.status === 'completed') {
    publishOperatorEvent({
      id: `workflow-completed-${params.chainId}`,
      type: 'workflow_completed',
      source: 'intelligence',
      severity: 'success',
      workflowId: params.chainId,
      workflowStatus: updated.status,
    });
  } else if (updated.status === 'blocked') {
    publishOperatorEvent({
      id: `workflow-blocked-${params.chainId}`,
      type: 'workflow_blocked',
      source: 'intelligence',
      severity: 'warning',
      workflowId: params.chainId,
      workflowStatus: updated.status,
    });
  }

  return { ...updated, steps: [...updated.steps] };
}

/** Wipes all chains (e.g. session end / test teardown). */
export function clearWorkflowChains(): void {
  _chains = [];
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns a shallow copy of all chains (never the internal reference). */
export function getWorkflowChains(): WorkflowChain[] {
  return _chains.map(c => ({ ...c, steps: [...c.steps] }));
}

/** Returns a copy of one chain by id, or null if not found. */
export function getWorkflowChain(id: string): WorkflowChain | null {
  const chain = _chains.find(c => c.id === id);
  if (!chain) return null;
  return { ...chain, steps: [...chain.steps] };
}
