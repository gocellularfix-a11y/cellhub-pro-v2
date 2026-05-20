// R-WORKFLOW-CHAIN-V1 — public surface for workflow chain module.
// Legacy conversational workflow types (WorkflowStep, WorkflowStepKind, etc.)
// are NOT re-exported here. Import them directly from ./types.ts to keep the
// two systems visually distinct at call sites.

export * as WorkflowChainTypes from './workflowChainTypes';

export type {
  WorkflowChainStatus,
  WorkflowChainStepStatus,
  WorkflowChainStepKind,
  WorkflowChainStep,
  WorkflowChain,
  WorkflowTransitionReason,
  WorkflowTransition,
} from './workflowChainTypes';
export {
  createWorkflowChain,
  createWorkflowChainStep,
  getWorkflowChains,
  getWorkflowChain,
  addWorkflowChainStep,
  updateWorkflowChainStepStatus,
  clearWorkflowChains,
  createWorkflowChainFromApproval,
  syncWorkflowStepFromApproval,
  createWorkflowTransition,
  getWorkflowTransitions,
  clearWorkflowTransitions,
} from './workflowChain';
