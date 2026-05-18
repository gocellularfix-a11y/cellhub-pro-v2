// CellHub Intelligence — Workflow Continuation Scoring
// Pure deterministic scoring — no I/O, no side effects, no randomness.
// R-INTELLIGENCE-WORKFLOW-CONTINUATION-V1

import type { WorkflowContinuationReason, WorkflowUrgency } from './workflowContinuationTypes';

// Base priority score per reason. Higher = surfaces first.
const BASE_SCORES: Record<WorkflowContinuationReason, number> = {
  external_payment_pending:     95, // Money collection interrupted — highest priority
  repair_loop_unresolved:       72, // Operator looping without resolution — customer waiting
  deal_reply_stalled:           68, // Customer replied; deal momentum at risk
  proposal_reply_stalled:       65, // Proposal reply received; follow-up opportunity
  deal_negotiation_stalled:     60, // Active negotiation going cold
  customer_loop_unresolved:     58, // Repeated customer views without engagement
  operational_workflow_stalled: 55, // Structured workflow not advancing
};

// Adds up to +15 bonus as staleness approaches maxMs. Older = more overdue.
function staleBonus(staleSinceMs: number, maxMs: number): number {
  return Math.round(Math.min(staleSinceMs / maxMs, 1) * 15);
}

function toUrgency(score: number): WorkflowUrgency {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

/**
 * Compute final score and urgency for a resumable workflow.
 * @param reason  - Why the workflow is surfaced
 * @param staleSinceMs - How long (ms) since first interruption
 */
export function scoreWorkflow(
  reason: WorkflowContinuationReason,
  staleSinceMs: number,
): { score: number; urgency: WorkflowUrgency } {
  const base = BASE_SCORES[reason];
  const bonus = staleBonus(staleSinceMs, 4 * 3600_000); // max bonus at 4h stale
  const score = Math.min(base + bonus, 100);
  return { score, urgency: toUrgency(score) };
}
