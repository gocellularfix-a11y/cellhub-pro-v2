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
  WorkflowGraphReadinessResult,
  WorkflowExecutionCandidatesResult,
  WorkflowPlanResult,
  WorkflowExecutionDecision,
  WorkflowExecutionDecisionResult,
  WorkflowPolicyEvaluation,
  WorkflowPolicyEvaluationResult,
  WorkflowOrchestrationIntent,
  WorkflowOrchestrationIntentResult,
  WorkflowRuntimeCapability,
  WorkflowRuntimeCapabilityKind,
  WorkflowRuntimeCapabilityResult,
  WorkflowExecutionContract,
  WorkflowExecutionContractRequirement,
  WorkflowExecutionContractResult,
  WorkflowRuntimeBoundary,
  WorkflowRuntimeBoundaryResult,
  WorkflowExecutionSessionIdentity,
  WorkflowExecutionSessionIdentityResult,
  WorkflowRuntimeOwnership,
  WorkflowRuntimeOwnershipResult,
  WorkflowAuthorityResolution,
  WorkflowAuthorityResolutionResult,
  WorkflowAuthorityDelegation,
  WorkflowAuthorityDelegationResult,
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

function isDependencySatisfied(
  kind: WorkflowDependencyKind,
  dependsOnStatus: WorkflowChainStepStatus | undefined,
): boolean {
  if (kind === 'blocks_until_resolved') {
    // Resolved when the blocking step has reached a terminal state:
    // completed = resolved successfully; blocked = resolved as cannot-continue.
    // draft / ready / waiting_approval are NOT resolved — still in-flight.
    // Missing step counts as unsatisfied.
    return dependsOnStatus === 'completed' || dependsOnStatus === 'blocked';
  }
  // requires_completion | requires_approval | requires_manual_action
  return dependsOnStatus === 'completed';
}

/**
 * Evaluates the dependency state for a single step.
 * Pure read — no mutations, no events, no side effects.
 * Satisfaction semantics are per-kind (see isDependencySatisfied).
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
    if (isDependencySatisfied(dep.kind, depStep?.status)) {
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

/**
 * Readiness evaluation combined with dependency graph inspection.
 * Pure read — no mutations, no events, no side effects.
 * readyStepIds from base result is preserved unchanged.
 * dependencyReadyStepIds  = ready steps with all dependencies satisfied (or none declared).
 * dependencyBlockedStepIds = ready steps with at least one unresolved dependency.
 * Returns null if the workflow chain does not exist.
 */
export function evaluateWorkflowGraphReadiness(workflowId: string): WorkflowGraphReadinessResult | null {
  const base = evaluateWorkflowReadiness(workflowId);
  if (!base) return null;

  const dependencyBlockedStepIds: string[] = [];
  const dependencyReadyStepIds: string[] = [];

  for (const stepId of base.readyStepIds) {
    const depState = evaluateWorkflowDependencyState({ workflowId, stepId });
    if (depState && depState.unresolvedDependencyStepIds.length > 0) {
      dependencyBlockedStepIds.push(stepId);
    } else {
      dependencyReadyStepIds.push(stepId);
    }
  }

  return { ...base, dependencyBlockedStepIds, dependencyReadyStepIds };
}

/**
 * Returns the set of steps that are structural candidates for execution.
 * Pure read — no mutations, no events, no side effects, no execution.
 * This function does NOT apply execution policies (permissions, priority,
 * throttling, concurrency, execution windows). Those are a future layer.
 * candidateStepIds    = dependency-clear ready steps (structural only).
 * blockedReadyStepIds = ready steps still held by unresolved dependencies.
 * Returns null if the workflow chain does not exist.
 */
export function evaluateWorkflowExecutionCandidates(workflowId: string): WorkflowExecutionCandidatesResult | null {
  const graph = evaluateWorkflowGraphReadiness(workflowId);
  if (!graph) return null;

  return {
    workflowId,
    candidateStepIds:    graph.dependencyReadyStepIds,
    blockedReadyStepIds: graph.dependencyBlockedStepIds,
    reason: 'dependency_clear_ready_steps',
    mode:   'structural_candidates_only',
  };
}

/**
 * Builds a ranked plan of ready and blocked steps for a workflow.
 * Planning is PASSIVE — no mutations, no events, no side effects, no execution.
 * Planning is NOT orchestration, NOT permission/policy evaluation, NOT execution.
 * All plan items carry decisionState 'not_decided': candidates are observed,
 * not committed. Policies are applied by a future layer, not here.
 * Insertion order is preserved; no dynamic priority sorting is applied.
 * Returns null if the workflow chain does not exist.
 */
export function evaluateWorkflowPlan(workflowId: string): WorkflowPlanResult | null {
  const candidates = evaluateWorkflowExecutionCandidates(workflowId);
  if (!candidates) return null;

  const ready = candidates.candidateStepIds.map((stepId, i) => ({
    workflowId,
    stepId,
    status:          'ready'                as const,
    structuralState: 'dependency_clear'     as const,
    rank:            i + 1,
    reason:          'dependency_clear'     as const,
    candidateKind:   'structural_candidate' as const,
    decisionState:   'not_decided'          as const,
  }));

  const blocked = candidates.blockedReadyStepIds.map((stepId, i) => ({
    workflowId,
    stepId,
    // status is 'ready' because the step is structurally eligible;
    // structuralState distinguishes that dependencies are not yet clear.
    status:          'ready'                as const,
    structuralState: 'dependency_blocked'   as const,
    rank:            i + 1,
    reason:          'dependency_blocked'   as const,
    candidateKind:   'structural_candidate' as const,
    decisionState:   'not_decided'          as const,
  }));

  return { workflowId, ready, blocked, mode: 'passive_plan_only' };
}

/**
 * Maps a passive plan into execution-decision primitives.
 * This is the layer between planning and execution — it is NOT execution itself.
 * Decisions do NOT mutate workflow state.
 * Decisions do NOT publish events.
 * Decisions do NOT trigger side effects, scheduling, or orchestration.
 * No policy engine exists yet — all decisions default to 'undecided' / 'policy_pending'.
 * No orchestrator exists yet — this is a passive, read-only primitive.
 * A future policy layer consumes these decisions and may flip state to
 * 'allowed', 'blocked', or 'deferred'. That layer does not exist yet.
 * Separation: candidate ≠ plan ≠ decision ≠ execution.
 */
export function evaluateWorkflowExecutionDecisions(
  plan: WorkflowPlanResult,
): WorkflowExecutionDecisionResult {
  const allItems = [...plan.ready, ...plan.blocked];

  const decisions: WorkflowExecutionDecision[] = allItems.map(item => ({
    workflowId:    item.workflowId,
    stepId:        item.stepId,
    state:         'undecided'              as const,
    reason:        'policy_pending'         as const,
    planRank:      item.rank,
    candidateKind: 'structural_candidate'   as const,
  }));

  return { workflowId: plan.workflowId, decisions, mode: 'execution_decision_passive' };
}

/**
 * Evaluates passive policy primitives for a set of execution decisions.
 * Policy evaluation is the layer between decisions and future orchestration.
 * Policies are PASSIVE evaluations only — they are NOT execution.
 * Policies do NOT execute workflows.
 * Policies do NOT mutate workflow state.
 * Policies do NOT publish events.
 * Policies do NOT schedule execution or trigger side effects.
 * No permission system exists yet — all evaluations default to 'pending' / 'no_policy_engine'.
 * No concurrency control or execution window system exists yet.
 * A future policy engine consumes these and may resolve state to 'permitted' or 'denied'.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ execution.
 */
export function evaluateWorkflowPolicies(
  decisionResult: WorkflowExecutionDecisionResult,
): WorkflowPolicyEvaluationResult {
  const evaluations: WorkflowPolicyEvaluation[] = decisionResult.decisions.map(decision => ({
    workflowId:    decision.workflowId,
    stepId:        decision.stepId,
    state:         'pending'                as const,
    reason:        'no_policy_engine'       as const,
    planRank:      decision.planRank,
    candidateKind: 'structural_candidate'   as const,
  }));

  return { workflowId: decisionResult.workflowId, evaluations, mode: 'policy_evaluation_passive' };
}

/**
 * Maps passive policy evaluations into orchestration-intent primitives.
 * Orchestration intent is the layer between policy and future runtime.
 * Orchestration intent is NOT orchestration.
 * Orchestration intent does NOT execute workflows.
 * Orchestration intent does NOT mutate workflow state.
 * Orchestration intent does NOT publish events.
 * Orchestration intent does NOT schedule, retry, or trigger side effects.
 * No orchestration runtime exists yet — all intents default to 'awaiting_runtime' / 'runtime_not_available'.
 * No scheduler or retry system exists yet — this is a passive, read-only primitive.
 * A future runtime consumes these intents and decides whether to proceed.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ execution.
 */
export function evaluateWorkflowOrchestrationIntent(
  policyResult: WorkflowPolicyEvaluationResult,
): WorkflowOrchestrationIntentResult {
  const intents: WorkflowOrchestrationIntent[] = policyResult.evaluations.map(evaluation => ({
    workflowId:    evaluation.workflowId,
    stepId:        evaluation.stepId,
    state:         'awaiting_runtime'       as const,
    reason:        'runtime_not_available'  as const,
    planRank:      evaluation.planRank,
    candidateKind: 'structural_candidate'   as const,
  }));

  return { workflowId: policyResult.workflowId, intents, mode: 'orchestration_intent_passive' };
}

const ALL_RUNTIME_CAPABILITY_KINDS: WorkflowRuntimeCapabilityKind[] = [
  'scheduling',
  'retries',
  'concurrency_control',
  'execution_windows',
  'approval_gates',
  'manual_action_gates',
  'remote_execution',
  'companion_execution',
];

/**
 * Returns a passive descriptive capability snapshot for a workflow's orchestration intents.
 * Capabilities describe what a future orchestration runtime MAY support.
 * Capabilities are DESCRIPTIVE ONLY — they do NOT create runtime behavior.
 * Capabilities do NOT execute workflows.
 * Capabilities do NOT mutate workflow state.
 * Capabilities do NOT publish events.
 * Capabilities do NOT schedule, retry, or trigger side effects.
 * No orchestration runtime exists yet.
 * No execution, scheduling, or retry systems exist yet.
 * A future runtime consumes this result to understand what feature surface it must satisfy.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution.
 */
export function evaluateWorkflowRuntimeCapabilities(
  intentResult: WorkflowOrchestrationIntentResult,
): WorkflowRuntimeCapabilityResult {
  const capabilities: WorkflowRuntimeCapability[] = ALL_RUNTIME_CAPABILITY_KINDS.map(kind => ({
    kind,
    state: 'future_supported' as const,
  }));

  return { workflowId: intentResult.workflowId, capabilities, mode: 'runtime_capability_passive' };
}

const ALL_CONTRACT_REQUIREMENTS: WorkflowExecutionContractRequirement[] = [
  'approval',
  'manual_confirmation',
  'execution_runtime',
  'execution_window',
  'retry_support',
  'concurrency_control',
  'audit_logging',
  'remote_transport',
  'companion_transport',
];

/**
 * Produces passive execution-contract descriptors for a workflow.
 * Execution contracts are DESCRIPTIVE ONLY — they do NOT execute workflows.
 * Contracts describe what a future execution runtime REQUIRES to run a step.
 * Contracts do NOT create runtime behavior.
 * Contracts do NOT mutate workflow state.
 * Contracts do NOT publish events.
 * Contracts do NOT schedule, retry, or trigger side effects.
 * No execution runtime exists yet.
 * No orchestration runtime exists yet.
 * A future executor consumes these contracts to verify prerequisites before running.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ execution.
 */
export function evaluateWorkflowExecutionContracts(
  capabilityResult: WorkflowRuntimeCapabilityResult,
): WorkflowExecutionContractResult {
  const contracts: WorkflowExecutionContract[] = ALL_CONTRACT_REQUIREMENTS.map(requirement => ({
    requirement,
    state: 'future_supported' as const,
  }));

  return {
    workflowId:          capabilityResult.workflowId,
    contracts,
    mode:                'execution_contract_passive',
    descriptorBoundary:  'final_pre_runtime_descriptor',
  };
}

/**
 * Produces a passive runtime-boundary descriptor for a workflow.
 * Runtime boundary defines the SHAPE and AUTHORITY of a future runtime.
 * Boundary is NOT runtime — it does NOT execute workflows.
 * Boundary does NOT mutate workflow state.
 * Boundary does NOT publish events.
 * Boundary does NOT schedule, retry, or trigger side effects.
 * No runtime implementation exists yet — this is a passive, read-only primitive.
 * A future runtime implementation MUST consume this boundary before executing.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution.
 */
export function evaluateWorkflowRuntimeBoundary(
  contractResult: WorkflowExecutionContractResult,
): WorkflowRuntimeBoundaryResult {
  const boundary: WorkflowRuntimeBoundary = {
    workflowId:        contractResult.workflowId,
    runtimeBoundaryId: `workflow-runtime-boundary-${contractResult.workflowId}`,
    boundaryScope:     'workflow_boundary',
    authority:         'runtime_required',
    lifecycleState:    'waiting_for_runtime',
  };

  return { workflowId: contractResult.workflowId, boundary, mode: 'runtime_boundary_passive' };
}

/**
 * Produces a passive deterministic execution-session identity for a workflow.
 * Session identity is passive only — it does NOT execute workflows.
 * Session identity does NOT start runtime.
 * Session identity does NOT mutate workflow state.
 * Session identity does NOT publish events.
 * sessionId is deterministic: workflow-execution-session-{workflowId}.
 * No timestamps, counters, random values, or runtime state are included.
 * Future runtime uses sessionId for replay, idempotency, and cancellation targeting.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution session identity ≠ execution.
 */
export function evaluateWorkflowExecutionSessionIdentity(
  boundaryResult: WorkflowRuntimeBoundaryResult,
): WorkflowExecutionSessionIdentityResult {
  const sessionIdentity: WorkflowExecutionSessionIdentity = {
    workflowId:    boundaryResult.workflowId,
    sessionId:     `workflow-execution-session-${boundaryResult.workflowId}`,
    scope:         'workflow',
    state:         'waiting_for_runtime',
    identityLevel: 'workflow_session_identity',
  };

  return { workflowId: boundaryResult.workflowId, sessionIdentity, mode: 'session_identity_passive' };
}

/**
 * Produces a passive runtime-ownership descriptor for a workflow.
 * Ownership is passive only — it does NOT execute workflows.
 * Ownership does NOT grant real permissions to users or devices.
 * Ownership does NOT assign real users or devices — no runtime exists yet.
 * Ownership does NOT publish events.
 * Ownership does NOT schedule, retry, or trigger side effects.
 * ownershipId is deterministic: workflow-runtime-ownership-{workflowId}.
 * No timestamps, counters, random values, or environment data are included.
 * Future runtime consumes this to resolve authority and coordinate multi-device execution.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution session identity ≠ runtime ownership ≠ execution.
 */
export function evaluateWorkflowRuntimeOwnership(
  sessionIdentityResult: WorkflowExecutionSessionIdentityResult,
): WorkflowRuntimeOwnershipResult {
  const ownership: WorkflowRuntimeOwnership = {
    workflowId:  sessionIdentityResult.workflowId,
    ownershipId: `workflow-runtime-ownership-${sessionIdentityResult.workflowId}`,
    ownerKind:   'future_runtime',
    state:       'pending_assignment',
  };

  return { workflowId: sessionIdentityResult.workflowId, ownership, mode: 'runtime_ownership_passive' };
}

/**
 * Produces a passive authority-resolution descriptor for a workflow.
 * Authority resolution is passive only — it does NOT grant permission to any actor.
 * Authority resolution does NOT execute workflows.
 * Authority resolution does NOT mutate workflow state.
 * Authority resolution does NOT publish events.
 * Authority resolution does NOT assign real users or devices.
 * authorityId is deterministic: workflow-authority-resolution-{workflowId}.
 * No timestamps, counters, random values, or environment data are included.
 * Future permission and runtime systems MUST consume this before acting.
 * Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution session identity ≠ runtime ownership ≠ authority resolution ≠ execution.
 */
export function evaluateWorkflowAuthorityResolution(
  ownershipResult: WorkflowRuntimeOwnershipResult,
): WorkflowAuthorityResolutionResult {
  const authorityResolution: WorkflowAuthorityResolution = {
    workflowId:  ownershipResult.workflowId,
    authorityId: `workflow-authority-resolution-${ownershipResult.workflowId}`,
    actorKind:   'future_runtime',
    state:       'pending_authority',
    requirement: 'future_permission_system_required',
  };

  return { workflowId: ownershipResult.workflowId, authorityResolution, mode: 'authority_resolution_passive' };
}

/**
 * Produces a passive authority-delegation descriptor for a workflow.
 * Delegation is passive only — it does NOT grant authority to any actor.
 * Delegation does NOT revoke real authority from any actor.
 * Delegation does NOT execute workflows.
 * Delegation does NOT mutate workflow state.
 * Delegation does NOT publish events.
 * delegationId is deterministic: workflow-authority-delegation-{workflowId}.
 * No timestamps, counters, random values, or environment data are included.
 * Future runtime and permission systems MUST consume this before acting.
 * Separation: ownership ≠ authority resolution ≠ authority delegation ≠ execution.
 */
export function evaluateWorkflowAuthorityDelegation(
  authorityResult: WorkflowAuthorityResolutionResult,
): WorkflowAuthorityDelegationResult {
  const delegation: WorkflowAuthorityDelegation = {
    workflowId:   authorityResult.workflowId,
    delegationId: `workflow-authority-delegation-${authorityResult.workflowId}`,
    kind:         'none',
    state:        'not_delegated',
  };

  return { workflowId: authorityResult.workflowId, delegation, mode: 'authority_delegation_passive' };
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
