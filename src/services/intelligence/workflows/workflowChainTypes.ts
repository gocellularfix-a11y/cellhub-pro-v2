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

// ── R-WORKFLOW-EXECUTION-CANDIDATES-V1 ───────────────────────────────────────

export type WorkflowExecutionCandidatesResult = {
  workflowId: string;
  /**
   * Structurally executable candidates only.
   * These are NOT final execution decisions — policies (permissions, priority,
   * throttling, concurrency, execution windows) are applied by a future layer.
   */
  candidateStepIds: string[];
  /** Steps that are ready but blocked by unresolved graph dependencies. */
  blockedReadyStepIds: string[];
  reason: 'dependency_clear_ready_steps';
  mode: 'structural_candidates_only';
};

// ── R-WORKFLOW-PLANNING-PRIMITIVES-V1 ────────────────────────────────────────
// Planning is PASSIVE — it observes structural candidates and produces an
// ordered view for inspection only.
// Planning is NOT orchestration.
// Planning is NOT permission or policy evaluation.
// Planning is NOT execution.
// No mutations, no events, no timeline writes occur during planning.

export type WorkflowPlanMode =
  | 'passive_plan_only'
  | 'planning_only';  // legacy alias — prefer 'passive_plan_only'

export type WorkflowPlanItem = {
  workflowId: string;
  stepId: string;
  /**
   * Source workflow readiness state at plan-generation time.
   * Structural candidates are always 'ready' at the step level.
   * Note: blocked plan items may still originate from ready workflow states —
   * 'ready' here means the step itself is eligible, not that dependencies are clear.
   * Use structuralState to determine dependency-graph outcome.
   */
  status: WorkflowChainStepStatus;
  /**
   * Dependency graph outcome for this plan item.
   * 'dependency_clear'   = all dependencies satisfied; step is a structural execution candidate.
   * 'dependency_blocked' = step is in a ready workflow state but held by unresolved dependencies.
   * This field clarifies semantic meaning that status alone does not convey.
   * Planning layer remains passive only — structuralState is descriptive, not prescriptive.
   */
  structuralState: 'dependency_clear' | 'dependency_blocked';
  /** Insertion-order rank (1-based). No dynamic priority sorting is applied. */
  rank: number;
  reason: 'dependency_clear' | 'dependency_blocked';
  /** Derived from structural candidate detection only — never filtered by policy. */
  candidateKind: 'structural_candidate';
  /**
   * No execution decision has been made for this item.
   * Policies (permissions, priority, throttling, concurrency, execution windows)
   * are applied by a future layer, not by planning.
   */
  decisionState: 'not_decided';
};

export type WorkflowPlanResult = {
  workflowId: string;
  ready: WorkflowPlanItem[];
  blocked: WorkflowPlanItem[];
  mode: WorkflowPlanMode;
};

// ── R-WORKFLOW-EXECUTION-DECISION-PRIMITIVES-V1 ──────────────────────────────
// Execution decisions sit between passive planning and future execution.
// Decisions are NOT execution.
// Decisions do NOT mutate workflow state.
// Decisions do NOT publish events.
// Decisions do NOT trigger side effects or scheduling.
// No policy engine exists yet — the default state is 'undecided' / 'policy_pending'.
// No orchestrator exists yet — this is a passive, read-only primitive.
// Separation: candidate ≠ plan ≠ decision ≠ execution.

export type WorkflowExecutionDecisionState =
  | 'undecided'
  | 'allowed'
  | 'blocked'
  | 'deferred';

export type WorkflowExecutionDecisionReason =
  | 'structural_candidate'
  | 'policy_pending'
  | 'approval_required'
  | 'dependency_blocked'
  | 'manual_action_required'
  | 'future_scheduler_required';

export type WorkflowExecutionDecision = {
  workflowId: string;
  stepId: string;
  state: WorkflowExecutionDecisionState;
  reason: WorkflowExecutionDecisionReason;
  /** Insertion-order rank carried forward from the source plan item. */
  planRank: number;
  /** Origin — always 'structural_candidate' at this layer. */
  candidateKind: 'structural_candidate';
};

export type WorkflowExecutionDecisionResult = {
  workflowId: string;
  decisions: WorkflowExecutionDecision[];
  /** Mode marker — the decision layer is always passive. */
  mode: 'execution_decision_passive';
};

// ── R-WORKFLOW-POLICY-PRIMITIVES-V1 ──────────────────────────────────────────
// Policy evaluation sits between execution decisions and future orchestration.
// Policies are PASSIVE evaluations only.
// Policies do NOT execute workflows.
// Policies do NOT mutate workflow state.
// Policies do NOT publish events.
// Policies do NOT schedule execution.
// No permission system exists yet — the default state is 'pending' / 'no_policy_engine'.
// No concurrency control exists yet — this is a passive, read-only primitive.
// No execution window system exists yet.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ execution.

export type WorkflowPolicyEvaluationState =
  | 'permitted'
  | 'denied'
  | 'pending'
  | 'requires_approval'
  | 'requires_manual_action';

export type WorkflowPolicyEvaluationReason =
  | 'no_policy_engine'
  | 'approval_required'
  | 'manual_action_required'
  | 'dependency_blocked'
  | 'future_permission_system'
  | 'future_execution_window'
  | 'future_concurrency_control';

export type WorkflowPolicyEvaluation = {
  workflowId: string;
  stepId: string;
  state: WorkflowPolicyEvaluationState;
  reason: WorkflowPolicyEvaluationReason;
  /** Plan rank carried forward from the source decision. */
  planRank: number;
  /** Origin — always 'structural_candidate' at this layer. */
  candidateKind: 'structural_candidate';
};

export type WorkflowPolicyEvaluationResult = {
  workflowId: string;
  evaluations: WorkflowPolicyEvaluation[];
  /** Mode marker — policy evaluation is always passive. */
  mode: 'policy_evaluation_passive';
};

// ── R-WORKFLOW-ORCHESTRATION-INTENT-PRIMITIVES-V1 ────────────────────────────
// Orchestration intent sits between policy evaluation and future orchestration runtime.
// Orchestration intent is NOT orchestration.
// Orchestration intent does NOT execute workflows.
// Orchestration intent does NOT mutate workflow state.
// Orchestration intent does NOT publish events.
// Orchestration intent does NOT schedule, retry, or trigger side effects.
// No orchestration runtime exists yet — the default state is 'awaiting_runtime'.
// No scheduler or retry system exists yet — this is a passive, read-only primitive.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ execution.

export type WorkflowOrchestrationIntentState =
  | 'idle'
  | 'awaiting_runtime'
  | 'blocked'
  | 'awaiting_approval'
  | 'awaiting_manual_action';

export type WorkflowOrchestrationIntentReason =
  | 'runtime_not_available'
  | 'policy_pending'
  | 'approval_required'
  | 'manual_action_required'
  | 'dependency_blocked'
  | 'future_scheduler_required'
  | 'future_concurrency_resolution';

export type WorkflowOrchestrationIntent = {
  workflowId: string;
  stepId: string;
  state: WorkflowOrchestrationIntentState;
  reason: WorkflowOrchestrationIntentReason;
  /** Plan rank carried forward from the source policy evaluation. */
  planRank: number;
  /** Origin — always 'structural_candidate' at this layer. */
  candidateKind: 'structural_candidate';
};

export type WorkflowOrchestrationIntentResult = {
  workflowId: string;
  intents: WorkflowOrchestrationIntent[];
  /** Mode marker — orchestration intent is always passive. */
  mode: 'orchestration_intent_passive';
};

// ── R-WORKFLOW-RUNTIME-CAPABILITY-PRIMITIVES-V1 ──────────────────────────────
// Runtime capability primitives are DESCRIPTIVE ONLY.
// Capabilities describe what a future orchestration runtime MAY support.
// Capabilities do NOT create runtime behavior.
// Capabilities do NOT execute workflows.
// Capabilities do NOT mutate workflow state.
// Capabilities do NOT publish events.
// Capabilities do NOT schedule, retry, or trigger side effects.
// No orchestration runtime exists yet.
// No execution systems exist yet.
// No scheduling or retry systems exist yet.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution.

export type WorkflowRuntimeCapabilityKind =
  | 'scheduling'
  | 'retries'
  | 'concurrency_control'
  | 'execution_windows'
  | 'approval_gates'
  | 'manual_action_gates'
  | 'remote_execution'
  | 'companion_execution';

export type WorkflowRuntimeCapabilityState =
  | 'unavailable'
  | 'future_supported'
  | 'runtime_required';

export type WorkflowRuntimeCapability = {
  kind: WorkflowRuntimeCapabilityKind;
  state: WorkflowRuntimeCapabilityState;
};

export type WorkflowRuntimeCapabilityResult = {
  workflowId: string;
  capabilities: WorkflowRuntimeCapability[];
  /** Mode marker — runtime capability evaluation is always passive and descriptive. */
  mode: 'runtime_capability_passive';
};

// ── R-WORKFLOW-EXECUTION-CONTRACT-PRIMITIVES-V1 ──────────────────────────────
// Execution contracts are DESCRIPTIVE ONLY.
// Contracts describe what a future execution runtime REQUIRES to run a step.
// Contracts do NOT execute workflows.
// Contracts do NOT create runtime behavior.
// Contracts do NOT mutate workflow state.
// Contracts do NOT publish events.
// Contracts do NOT schedule, retry, or trigger side effects.
// No execution runtime exists yet.
// No orchestration runtime exists yet.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ execution.

export type WorkflowExecutionContractRequirement =
  | 'approval'
  | 'manual_confirmation'
  | 'execution_runtime'
  | 'execution_window'
  | 'retry_support'
  | 'concurrency_control'
  | 'audit_logging'
  | 'remote_transport'
  | 'companion_transport';

export type WorkflowExecutionContractState =
  | 'unresolved'
  | 'future_supported'
  | 'runtime_required';

export type WorkflowExecutionContract = {
  requirement: WorkflowExecutionContractRequirement;
  state: WorkflowExecutionContractState;
};

export type WorkflowExecutionContractResult = {
  workflowId: string;
  contracts: WorkflowExecutionContract[];
  /** Mode marker — execution contract evaluation is always passive and descriptive. */
  mode: 'execution_contract_passive';
  /**
   * FINAL PASSIVE PRE-RUNTIME DESCRIPTOR LAYER.
   * Execution contracts are the last layer before runtime boundary design.
   * Do NOT add more passive descriptor layers unless a concrete runtime boundary requires it.
   * Next architectural step is runtime boundary design, not more descriptors.
   * Contracts define runtime requirements, not runtime behavior.
   */
  descriptorBoundary: 'final_pre_runtime_descriptor';
};

// ── R-WORKFLOW-RUNTIME-BOUNDARY-PRIMITIVES-V1 ────────────────────────────────
// Runtime boundary primitives define the SHAPE and AUTHORITY of a future runtime.
// Runtime boundary is NOT runtime.
// Boundary does NOT execute workflows.
// Boundary does NOT mutate workflow state.
// Boundary does NOT publish events.
// Boundary does NOT schedule, retry, or trigger side effects.
// No runtime implementation exists yet — this is a passive, read-only primitive.
// Future runtime implementation MUST consume this boundary before executing.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution.

export type WorkflowRuntimeAuthority =
  | 'none'
  | 'observe_only'
  | 'approval_required'
  | 'manual_confirmation_required'
  | 'runtime_required';

export type WorkflowRuntimeLifecycleState =
  | 'not_started'
  | 'waiting_for_runtime'
  | 'waiting_for_policy'
  | 'waiting_for_approval'
  | 'waiting_for_manual_action'
  | 'blocked'
  | 'ready_for_future_runtime';

export type WorkflowRuntimeBoundary = {
  workflowId: string;
  /**
   * Deterministic identity anchor for this runtime boundary.
   * Format: workflow-runtime-boundary-{workflowId}
   * Boundary is NOT an execution session.
   * Future execution sessions operate INSIDE this boundary, not as this boundary.
   * Future replay, cancellation, and idempotency systems depend on this distinction.
   */
  runtimeBoundaryId: string;
  /**
   * Scope of this boundary perimeter.
   * Defines runtime ownership extent only — not execution scope or step targeting.
   */
  boundaryScope: 'workflow_boundary';
  authority: WorkflowRuntimeAuthority;
  /**
   * Runtime-boundary lifecycle state.
   * This is NOT execution state.
   * This is NOT step execution progress.
   * This is NOT retry state.
   * This reflects only the lifecycle of the runtime boundary ownership perimeter.
   */
  lifecycleState: WorkflowRuntimeLifecycleState;
};

export type WorkflowRuntimeBoundaryResult = {
  workflowId: string;
  boundary: WorkflowRuntimeBoundary;
  /** Mode marker — runtime boundary evaluation is always passive. */
  mode: 'runtime_boundary_passive';
};

// ── R-WORKFLOW-EXECUTION-SESSION-IDENTITY-V1 ─────────────────────────────────
// Execution session identity is passive only.
// Session identity does NOT execute workflows.
// Session identity does NOT start runtime.
// Session identity does NOT mutate workflow state.
// Session identity does NOT publish events.
// Session identity is for future replay, idempotency, and cancellation boundaries.
// sessionId is deterministic — NO timestamps, counters, random values, or runtime state.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution session identity ≠ execution.

export type WorkflowExecutionSessionScope =
  | 'workflow'
  | 'step'
  | 'approval'
  | 'manual_action'
  | 'remote_action'
  | 'companion_action';

export type WorkflowExecutionSessionState =
  | 'declared'
  | 'waiting_for_runtime'
  | 'waiting_for_authority'
  | 'cancelled_before_runtime'
  | 'ready_for_future_runtime';

export type WorkflowExecutionSessionIdentity = {
  workflowId: string;
  /**
   * Deterministic session identity anchor.
   * Format: workflow-execution-session-{workflowId}
   * Deterministic by design — does NOT include timestamps, counters, or random values.
   * Future runtime uses this for replay, idempotency, and cancellation targeting.
   * Do NOT reuse this sessionId for step, approval, manual, remote, or companion sessions.
   * Future scoped session IDs MUST use their own format: {workflowId}-{scope}-{targetId}.
   */
  sessionId: string;
  scope: WorkflowExecutionSessionScope;
  state: WorkflowExecutionSessionState;
  /**
   * Identity level marker — this object represents workflow-level session identity only.
   * Step/action/approval-level sessions must declare their own identity objects later.
   * Mixing workflow-level and step-level sessionIds causes replay, cancellation,
   * retry-grouping, and companion-execution collisions.
   * This evaluator does NOT create step-level identities.
   */
  identityLevel: 'workflow_session_identity';
};

export type WorkflowExecutionSessionIdentityResult = {
  workflowId: string;
  sessionIdentity: WorkflowExecutionSessionIdentity;
  /** Mode marker — session identity evaluation is always passive. */
  mode: 'session_identity_passive';
};

// ── R-WORKFLOW-RUNTIME-OWNERSHIP-PRIMITIVES-V1 ───────────────────────────────
// Runtime ownership primitives define WHO/WHAT would own a future runtime session.
// Ownership is passive only — it does NOT execute workflows.
// Ownership does NOT grant real permissions to users or devices.
// Ownership does NOT assign real users or devices yet.
// Ownership does NOT publish events.
// Ownership does NOT schedule, retry, or trigger side effects.
// Ownership is for future runtime authority and multi-device coordination.
// ownershipId is deterministic — NO timestamps, counters, random values.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution session identity ≠ runtime ownership ≠ execution.

export type WorkflowRuntimeOwnerKind =
  | 'system'
  | 'user'
  | 'manager'
  | 'approval_queue'
  | 'companion'
  | 'remote_device'
  | 'future_runtime';

export type WorkflowRuntimeOwnershipState =
  | 'unassigned'
  | 'pending_assignment'
  | 'assigned_for_future_runtime'
  | 'blocked';

export type WorkflowRuntimeOwnership = {
  workflowId: string;
  /**
   * Deterministic ownership identity anchor.
   * Format: workflow-runtime-ownership-{workflowId}
   * Does NOT include timestamps, counters, random values, or device/runtime/environment data.
   * Used for future runtime authority resolution and multi-device coordination.
   */
  ownershipId: string;
  ownerKind: WorkflowRuntimeOwnerKind;
  state: WorkflowRuntimeOwnershipState;
};

export type WorkflowRuntimeOwnershipResult = {
  workflowId: string;
  ownership: WorkflowRuntimeOwnership;
  /** Mode marker — runtime ownership evaluation is always passive. */
  mode: 'runtime_ownership_passive';
};

// ── R-WORKFLOW-AUTHORITY-RESOLUTION-PRIMITIVES-V1 ────────────────────────────
// Authority resolution is passive only.
// Authority resolution does NOT grant permission to any actor.
// Authority resolution does NOT execute workflows.
// Authority resolution does NOT mutate workflow state.
// Authority resolution does NOT publish events.
// Authority resolution does NOT assign real users or devices.
// Future permission and runtime systems MUST consume this result before acting.
// authorityId is deterministic — NO timestamps, counters, random values.
// Separation: candidate ≠ plan ≠ decision ≠ policy ≠ orchestration intent ≠ runtime capability ≠ execution contract ≠ runtime boundary ≠ execution session identity ≠ runtime ownership ≠ authority resolution ≠ execution.

export type WorkflowAuthorityActorKind =
  | 'system'
  | 'cashier'
  | 'manager'
  | 'owner'
  | 'approval_queue'
  | 'companion'
  | 'remote_device'
  | 'future_runtime';

export type WorkflowAuthorityResolutionState =
  | 'unresolved'
  | 'pending_authority'
  | 'authority_required'
  | 'approved_for_future_runtime'
  | 'denied'
  | 'blocked';

export type WorkflowAuthorityRequirement =
  | 'runtime_owner_required'
  | 'manager_approval_required'
  | 'manual_confirmation_required'
  | 'companion_authority_required'
  | 'remote_device_authority_required'
  | 'future_permission_system_required';

export type WorkflowAuthorityResolution = {
  workflowId: string;
  /**
   * Deterministic authority identity anchor.
   * Format: workflow-authority-resolution-{workflowId}
   * Does NOT include timestamps, counters, random values, or device/runtime/environment data.
   * Future permission system uses this for authority lookup and audit.
   */
  authorityId: string;
  actorKind: WorkflowAuthorityActorKind;
  state: WorkflowAuthorityResolutionState;
  requirement: WorkflowAuthorityRequirement;
};

export type WorkflowAuthorityResolutionResult = {
  workflowId: string;
  authorityResolution: WorkflowAuthorityResolution;
  /** Mode marker — authority resolution is always passive. */
  mode: 'authority_resolution_passive';
};

// ── R-WORKFLOW-AUTHORITY-DELEGATION-PRIMITIVES-V1 ────────────────────────────
// Authority delegation is passive only.
// Delegation does NOT grant authority to any actor.
// Delegation does NOT revoke real authority from any actor.
// Delegation does NOT execute workflows.
// Delegation does NOT mutate workflow state.
// Delegation does NOT publish events.
// Future runtime and permission systems MUST consume this before acting.
// delegationId is deterministic — NO timestamps, counters, random values.
// Separation: ownership ≠ authority resolution ≠ authority delegation ≠ execution.

export type WorkflowAuthorityDelegationKind =
  | 'none'
  | 'manager_to_cashier'
  | 'owner_to_manager'
  | 'system_to_runtime'
  | 'runtime_to_companion'
  | 'runtime_to_remote_device'
  | 'approval_queue_to_actor';

export type WorkflowAuthorityDelegationState =
  | 'not_delegated'
  | 'pending_delegation'
  | 'delegated_for_future_runtime'
  | 'revoked'
  | 'stale'
  | 'blocked';

export type WorkflowAuthorityDelegation = {
  workflowId: string;
  /**
   * Deterministic delegation identity anchor.
   * Format: workflow-authority-delegation-{workflowId}
   * Does NOT include timestamps, counters, random values, or device/runtime/environment data.
   * Future permission system uses this for delegation tracking and audit.
   */
  delegationId: string;
  kind: WorkflowAuthorityDelegationKind;
  state: WorkflowAuthorityDelegationState;
};

export type WorkflowAuthorityDelegationResult = {
  workflowId: string;
  delegation: WorkflowAuthorityDelegation;
  /** Mode marker — authority delegation evaluation is always passive. */
  mode: 'authority_delegation_passive';
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
