// CellHub Intelligence — Workflow Continuation Types
// Pure TypeScript types — no React, no DOM, no I/O.
// R-INTELLIGENCE-WORKFLOW-CONTINUATION-V1

export type WorkflowUrgency = 'critical' | 'high' | 'medium' | 'low';

// Reason codes map 1-to-1 with detector functions in workflowContinuationEngine.
export type WorkflowContinuationReason =
  | 'external_payment_pending'    // External payment flow started but not completed
  | 'repair_loop_unresolved'      // Operator opened same repair 3+ times without follow-up
  | 'customer_loop_unresolved'    // Operator opened same customer 3+ times without follow-up
  | 'deal_reply_stalled'          // Customer replied to deal; no owner follow-up >2h
  | 'deal_negotiation_stalled'    // Deal in negotiating stage without update >4h
  | 'proposal_reply_stalled'      // Manual proposal received reply; no follow-up >2h
  | 'operational_workflow_stalled'; // Structured multi-step workflow stale >4h

export type WorkflowEntityType =
  | 'external_payment'
  | 'repair'
  | 'customer'
  | 'deal'
  | 'proposal'
  | 'workflow';

export type WorkflowActionType =
  | 'open_repair'
  | 'open_customer'
  | 'send_whatsapp'
  | 'resume_external_payment'
  | 'open_deal_pipeline';

export interface ResumableWorkflowAction {
  type: WorkflowActionType;
  label: string;
  labelEs: string;
  targetId?: string;
  targetPhone?: string;
  targetModule?: string;
}

export interface ResumableWorkflow {
  id: string;
  reason: WorkflowContinuationReason;
  urgency: WorkflowUrgency;
  score: number;                // 0–100
  title: string;
  titleEs: string;
  description: string;
  descriptionEs: string;
  entityType: WorkflowEntityType;
  entityId?: string;
  entityName?: string;
  resumeAction: ResumableWorkflowAction;
  detectedAt: number;           // epoch ms — when this detection ran
  staleSinceMs: number;         // how long the workflow has been interrupted
  sourceSystem:
    | 'workflowContinuityStore'
    | 'executionHistory'
    | 'dealPipeline'
    | 'proposalFollowups'
    | 'operationalWorkflows';
}

export interface WorkflowContinuationReport {
  generatedAt: number;
  workflows: ResumableWorkflow[];   // sorted by score desc, capped at MAX_WORKFLOWS
  topWorkflow: ResumableWorkflow | null;
  totalDetected: number;            // before cap — for diagnostic awareness
}
