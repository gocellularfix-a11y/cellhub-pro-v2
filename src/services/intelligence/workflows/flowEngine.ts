// R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1
// Operational workflow engine — deterministic, no AI, no ML.
//
// Workflow lifecycle:
//   pending → in_progress → waiting → completed
//           ↘ cancelled (manual or system)
//
// Auto-completion is driven by the auto-resolution layer in IntelligenceEngine:
//   evaluateQueueAutoResolution() → autoCompleteWorkflow()
//
// Step 0 (detection) is always marked complete on creation — the workflow exists
// because the issue was already detected. Subsequent steps advance via:
//   advanceWorkflowStep()  — operator action (approve queue item, mark done)
//   autoCompleteWorkflow() — system-driven (entity state cleared)

import type { OperationalWorkflow, WorkflowCategory, WorkflowStep } from './types';
import { STEP_TEMPLATES } from './types';
import {
  createWorkflow,
  updateWorkflow,
  completeWorkflow,
  getWorkflowByEntity,
  readWorkflows,
} from './store';
import { createOutcomeForWorkflow } from '../outcomes/outcomeEngine';

export type { OperationalWorkflow, WorkflowCategory };

// ── ensureOperationalWorkflow ─────────────────────────────────────────────────
// Idempotent: returns existing active workflow for the entity, or creates one.
// First step (detection) is immediately marked complete.

export interface EnsureWorkflowParams {
  category: WorkflowCategory;
  entityType?: string;
  entityId?: string;
  title: string;
  description: string;
  queueItemId?: string;
}

export function ensureOperationalWorkflow(
  params: EnsureWorkflowParams,
): OperationalWorkflow {
  // Return existing active workflow for this entity (dedup by entity).
  if (params.entityType && params.entityId) {
    const existing = getWorkflowByEntity(params.entityType, params.entityId);
    if (existing) return existing;
  }

  const template = STEP_TEMPLATES[params.category];
  const now = Date.now();

  // Build steps — step 0 (detection) is immediately complete.
  const steps: WorkflowStep[] = template.map((t, i) => ({
    id: t.id,
    label: t.label,
    completed: i === 0,
    ...(i === 0 ? { completedAt: now } : {}),
  }));

  // nextSuggestedAction = action needed to complete step 0 (leads to step 1).
  const nextSuggestedAction = template[0]?.nextAction;

  const wf = createWorkflow({
    category: params.category,
    status: 'pending',
    title: params.title,
    description: params.description,
    entityType: params.entityType,
    entityId: params.entityId,
    nextSuggestedAction,
    steps,
  });
  // R-INTELLIGENCE-OUTCOME-TRACKING-V1: create outcome idempotently and link it.
  const outcome = createOutcomeForWorkflow(wf, params.queueItemId);
  updateWorkflow(wf.id, { outcomeId: outcome.id });
  return wf;
}

// ── advanceWorkflowStep ───────────────────────────────────────────────────────
// Marks the next incomplete step as complete and updates the workflow status.
// If all steps are done, auto-completes the workflow.
// Called by the operator (queue approve, explicit "mark done").

export function advanceWorkflowStep(workflowId: string): OperationalWorkflow | null {
  const workflows = readWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf || wf.status === 'completed' || wf.status === 'cancelled') return null;

  const now = Date.now();
  const incompleteIdx = wf.steps.findIndex(s => !s.completed);
  if (incompleteIdx === -1) {
    // All steps already complete — close it.
    return completeWorkflow(workflowId);
  }

  const newSteps = wf.steps.map((s, i) =>
    i === incompleteIdx ? { ...s, completed: true, completedAt: now } : s,
  );

  // All done after this advance?
  if (newSteps.every(s => s.completed)) {
    // Write the final step completion, then complete the workflow.
    updateWorkflow(workflowId, { steps: newSteps });
    return completeWorkflow(workflowId);
  }

  // Find nextSuggestedAction from the template (based on the step JUST completed).
  const template = STEP_TEMPLATES[wf.category];
  const nextSuggestedAction = template[incompleteIdx]?.nextAction;

  return updateWorkflow(workflowId, {
    steps: newSteps,
    status: 'in_progress',
    nextSuggestedAction,
  });
}

// ── autoCompleteWorkflow ──────────────────────────────────────────────────────
// System-driven completion — called by auto-resolution when the underlying
// entity state clears (repair picked up, balance paid, customer returned).
// Marks all remaining steps complete and closes the workflow.

export function autoCompleteWorkflow(
  workflowId: string,
  reason?: string,
): OperationalWorkflow | null {
  const workflows = readWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf || wf.status === 'completed' || wf.status === 'cancelled') return null;

  const now = Date.now();
  const newSteps = wf.steps.map(s =>
    s.completed ? s : { ...s, completed: true, completedAt: now },
  );

  const descSuffix = reason ? `\nAuto-completed: ${reason}` : '';
  return updateWorkflow(workflowId, {
    steps: newSteps,
    status: 'completed',
    completedAt: now,
    nextSuggestedAction: undefined,
    description: wf.description + descSuffix,
  });
}
