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
  WorkflowTransition,
  WorkflowTransitionReason,
  WorkflowContinuation,
  WorkflowContinuationKind,
  WorkflowReadinessResult,
  WorkflowDependency,
  WorkflowDependencyKind,
} from './workflowChainTypes';
import type { ExecutionRequest } from '../executionPipeline/types';
import type { ApprovalQueueItem, ApprovalQueueStatus } from '../approvals/types';
import type { ResolvedEntity } from '../oce/entityResolution/types';
import { publishOperatorEvent } from '../events/operatorEventBus';

const MAX_CHAINS = 100;
const MAX_TRANSITIONS = 500;
const MAX_CONTINUATIONS = 500;
const MAX_DEPENDENCIES = 1000;

let _chains: WorkflowChain[] = [];
let _transitions: WorkflowTransition[] = [];
let _transitionSeq = 0;
let _continuations: WorkflowContinuation[] = [];
let _dependencies: WorkflowDependency[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveChainStatus(steps: WorkflowChainStep[]): WorkflowChainStatus {
  if (steps.some(s => s.status === 'blocked'))           return 'blocked';
  if (steps.some(s => s.status === 'waiting_approval'))  return 'waiting_approval';
  if (steps.length > 0 && steps.every(s => s.status === 'completed')) return 'completed';
  if (steps.some(s => s.status === 'ready'))             return 'ready';
  return 'draft';
}

function resolvedEntityId(entity: ResolvedEntity): string {
  switch (entity.type) {
    case 'customer':  return entity.customerId;
    case 'repair':    return entity.repairId;
    case 'sale':      return entity.saleId;
    case 'layaway':   return entity.layawayId;
    case 'inventory': return entity.sku;
  }
}

const APPROVAL_STATUS_MAP: Record<ApprovalQueueStatus, WorkflowChainStepStatus> = {
  pending:  'waiting_approval',
  approved: 'completed',
  rejected: 'blocked',
  expired:  'blocked',
};


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

  createWorkflowTransition({
    workflowId: chainId,
    fromStatus: prev.status,
    toStatus:   updated.status,
    reason:     'system_sync',
  });

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

  const transitionReason: WorkflowTransitionReason =
    params.status === 'completed' ? 'step_completed' :
    params.status === 'blocked'   ? 'step_blocked'   :
    'manual_update';

  createWorkflowTransition({
    workflowId: params.chainId,
    fromStatus: prev.status,
    toStatus:   updated.status,
    reason:     transitionReason,
  });

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

// ── Approval linkage helpers (R-WORKFLOW-APPROVAL-LINKAGE-V1) ────────────────

/**
 * Creates a WorkflowChain representing a single approval queue item.
 * Deterministic IDs: chain = workflow-approval-{id}, step = step-approval-{id}.
 * Does NOT mutate the approval item.
 */
export function createWorkflowChainFromApproval(params: {
  approval: ApprovalQueueItem;
  title?: string;
}): WorkflowChain {
  const { approval, title } = params;
  const entity = approval.request.entity;

  const step: WorkflowChainStep = {
    ...createWorkflowChainStep({
      id:           `step-approval-${approval.id}`,
      kind:         'approval_request',
      status:       'waiting_approval',
      titleKey:     title ?? `step-approval-${approval.id}`,
      approvalItem: approval,
    }),
    // Snapshot fields intentionally copied from approval/request/entity
    // to support stable workflow inspection, lookup, debugging,
    // timeline rendering, and future persistence layers.
    approvalId: approval.id,
    requestId:  approval.request.id,
    actionKey:  approval.request.action.key,
    entityType: entity.type,
    entityId:   resolvedEntityId(entity),
  };

  return createWorkflowChain({
    id:       `workflow-approval-${approval.id}`,
    titleKey: title ?? `workflow-approval-${approval.id}`,
    steps:    [step],
  });
}

/**
 * Syncs an approval item's current status into its corresponding workflow step.
 * Returns null if the workflow chain does not exist yet.
 * Does NOT mutate the approval item.
 */
export function syncWorkflowStepFromApproval(params: {
  approval: ApprovalQueueItem;
}): WorkflowChain | null {
  const chainId = `workflow-approval-${params.approval.id}`;
  const prevChain = getWorkflowChain(chainId);

  const result = updateWorkflowChainStepStatus({
    chainId,
    stepId: `step-approval-${params.approval.id}`,
    status: APPROVAL_STATUS_MAP[params.approval.status],
  });

  if (result !== null && prevChain !== null && prevChain.status !== result.status) {
    createWorkflowTransition({
      workflowId: chainId,
      fromStatus: prevChain.status,
      toStatus:   result.status,
      reason:     'approval_received',
    });
  }

  return result;
}

/** Wipes all chains (e.g. session end / test teardown). */
export function clearWorkflowChains(): void {
  _chains = [];
}

// ── Transitions (R-WORKFLOW-TRANSITIONS-V1) ───────────────────────────────────

/**
 * Records a workflow status transition.
 * Returns null (no-op) when fromStatus === toStatus — no actual change occurred.
 * key  = deterministic: transition-{workflowId}-{from}-{to}-{reason}
 * id   = `${key}-${sequence}` — unique across session, stable across replay
 * If an entry with the same id exists it is replaced in-place (idempotent).
 */
export function createWorkflowTransition(params: {
  workflowId: string;
  fromStatus: WorkflowChainStatus;
  toStatus: WorkflowChainStatus;
  reason: WorkflowTransitionReason;
}): WorkflowTransition | null {
  if (params.fromStatus === params.toStatus) return null;

  const now = Date.now();
  const key = `transition-${params.workflowId}-${params.fromStatus}-${params.toStatus}-${params.reason}`;
  const sequence = _transitionSeq + 1;
  _transitionSeq = sequence;
  const transition: WorkflowTransition = {
    id:         `${key}-${sequence}`,
    key,
    sequence,
    workflowId: params.workflowId,
    fromStatus: params.fromStatus,
    toStatus:   params.toStatus,
    reason:     params.reason,
    createdAt:  now,
  };

  const existingIdx = _transitions.findIndex(t => t.id === transition.id);
  if (existingIdx !== -1) {
    _transitions = [
      ..._transitions.slice(0, existingIdx),
      transition,
      ..._transitions.slice(existingIdx + 1),
    ];
  } else {
    const next = [..._transitions, transition];
    _transitions = next.length > MAX_TRANSITIONS ? next.slice(next.length - MAX_TRANSITIONS) : next;
  }

  return { ...transition };
}

/** Returns all transitions, or only those for the given workflowId. */
export function getWorkflowTransitions(workflowId?: string): WorkflowTransition[] {
  if (workflowId === undefined) return [..._transitions];
  return _transitions.filter(t => t.workflowId === workflowId);
}

/** Wipes all transitions and resets the sequence counter (e.g. session end / test teardown). */
export function clearWorkflowTransitions(): void {
  _transitions = [];
  _transitionSeq = 0;
}

// ── Continuations (R-WORKFLOW-CONTINUATION-PRIMITIVES-V1) ────────────────────

/**
 * Declares a possible continuation relationship between two steps.
 * Deterministic id: continuation-{workflowId}-{fromStepId}-{toStepId}-{kind}.
 * Replace-in-place if same id already exists (idempotent).
 * Does NOT execute or auto-progress any steps.
 */
export function createWorkflowContinuation(params: {
  workflowId: string;
  fromStepId: string;
  toStepId: string;
  kind: WorkflowContinuationKind;
}): WorkflowContinuation {
  const continuation: WorkflowContinuation = {
    id:         `continuation-${params.workflowId}-${params.fromStepId}-${params.toStepId}-${params.kind}`,
    workflowId: params.workflowId,
    fromStepId: params.fromStepId,
    toStepId:   params.toStepId,
    kind:       params.kind,
    createdAt:  Date.now(),
  };

  const existingIdx = _continuations.findIndex(c => c.id === continuation.id);
  if (existingIdx !== -1) {
    const existing = _continuations[existingIdx];
    const updated: WorkflowContinuation = {
      ...existing,
      ...continuation,
      id:        existing.id,
      createdAt: existing.createdAt,
    };
    _continuations = [
      ..._continuations.slice(0, existingIdx),
      updated,
      ..._continuations.slice(existingIdx + 1),
    ];
    return { ...updated };
  } else {
    const next = [..._continuations, continuation];
    _continuations = next.length > MAX_CONTINUATIONS ? next.slice(next.length - MAX_CONTINUATIONS) : next;
  }

  return { ...continuation };
}

/** Returns all continuations, or only those for the given workflowId. */
export function getWorkflowContinuations(workflowId?: string): WorkflowContinuation[] {
  if (workflowId === undefined) return [..._continuations];
  return _continuations.filter(c => c.workflowId === workflowId);
}

/** Wipes all continuations (e.g. session end / test teardown). */
export function clearWorkflowContinuations(): void {
  _continuations = [];
}

// ── Dependencies (R-WORKFLOW-DEPENDENCY-GRAPH-V1) ─────────────────────────────

/**
 * Declares a dependency between two steps in the same workflow.
 * Deterministic id: dependency-{workflowId}-{fromStepId}-{dependsOnStepId}-{kind}.
 * Replace-in-place if same id already exists (idempotent); preserves original createdAt.
 * Does NOT execute, auto-progress, or mutate any steps or chains.
 */
export function createWorkflowDependency(params: {
  workflowId: string;
  fromStepId: string;
  dependsOnStepId: string;
  kind: WorkflowDependencyKind;
}): WorkflowDependency {
  const dependency: WorkflowDependency = {
    id:              `dependency-${params.workflowId}-${params.fromStepId}-${params.dependsOnStepId}-${params.kind}`,
    workflowId:      params.workflowId,
    fromStepId:      params.fromStepId,
    dependsOnStepId: params.dependsOnStepId,
    kind:            params.kind,
    createdAt:       Date.now(),
  };

  const existingIdx = _dependencies.findIndex(d => d.id === dependency.id);
  if (existingIdx !== -1) {
    const existing = _dependencies[existingIdx];
    const updated: WorkflowDependency = {
      ...existing,
      ...dependency,
      id:        existing.id,
      createdAt: existing.createdAt,
    };
    _dependencies = [
      ..._dependencies.slice(0, existingIdx),
      updated,
      ..._dependencies.slice(existingIdx + 1),
    ];
    return { ...updated };
  }

  const next = [..._dependencies, dependency];
  _dependencies = next.length > MAX_DEPENDENCIES ? next.slice(next.length - MAX_DEPENDENCIES) : next;
  return { ...dependency };
}

/** Returns all dependencies, or only those for the given workflowId. */
export function getWorkflowDependencies(workflowId?: string): WorkflowDependency[] {
  if (workflowId === undefined) return [..._dependencies];
  return _dependencies.filter(d => d.workflowId === workflowId);
}

/** Wipes all dependencies (e.g. session end / test teardown). */
export function clearWorkflowDependencies(): void {
  _dependencies = [];
}

/**
 * Evaluates the dependency state for a single step.
 * Pure read — no mutations, no events, no side effects.
 * A dependency is satisfied when the dependsOn step status === 'completed'.
 * Returns null if the workflow chain does not exist.
 */
export function evaluateWorkflowDependencyState(params: {
  workflowId: string;
  stepId: string;
}): {
  blockedByStepIds: string[];
  satisfiedDependencyStepIds: string[];
  unresolvedDependencyStepIds: string[];
} | null {
  const chain = _chains.find(c => c.id === params.workflowId);
  if (!chain) return null;

  const deps = _dependencies.filter(
    d => d.workflowId === params.workflowId && d.fromStepId === params.stepId,
  );

  const blockedByStepIds: string[] = [];
  const satisfiedDependencyStepIds: string[] = [];
  const unresolvedDependencyStepIds: string[] = [];

  for (const dep of deps) {
    const depStep = chain.steps.find(s => s.id === dep.dependsOnStepId);
    if (depStep?.status === 'completed') {
      satisfiedDependencyStepIds.push(dep.dependsOnStepId);
    } else {
      unresolvedDependencyStepIds.push(dep.dependsOnStepId);
      blockedByStepIds.push(dep.dependsOnStepId);
    }
  }

  return { blockedByStepIds, satisfiedDependencyStepIds, unresolvedDependencyStepIds };
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Evaluates which steps in a workflow chain are ready, blocked, waiting, or complete.
 * Pure read — no mutations, no events, no side effects.
 * Returns null if the workflow chain does not exist.
 */
export function evaluateWorkflowReadiness(workflowId: string): WorkflowReadinessResult | null {
  const chain = _chains.find(c => c.id === workflowId);
  if (!chain) return null;

  const readyStepIds: string[] = [];
  const blockedStepIds: string[] = [];
  const waitingApprovalStepIds: string[] = [];
  const completedStepIds: string[] = [];

  for (const step of chain.steps) {
    if      (step.status === 'ready')            readyStepIds.push(step.id);
    else if (step.status === 'blocked')          blockedStepIds.push(step.id);
    else if (step.status === 'waiting_approval') waitingApprovalStepIds.push(step.id);
    else if (step.status === 'completed')        completedStepIds.push(step.id);
  }

  return { workflowId, readyStepIds, blockedStepIds, waitingApprovalStepIds, completedStepIds };
}

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
