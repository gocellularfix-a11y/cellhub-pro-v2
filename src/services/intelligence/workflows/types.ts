// R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1
// Operational workflow types — no imports from store or React.

export type WorkflowStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'cancelled';

export type WorkflowCategory =
  | 'repair_followup'
  | 'collection'
  | 'vip_retention'
  | 'inventory_action'
  | 'approval_review';

export interface WorkflowStep {
  id: string;
  label: string;
  completed: boolean;
  completedAt?: number;
}

export interface OperationalWorkflow {
  id: string;
  category: WorkflowCategory;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  title: string;
  description: string;
  entityType?: string;
  entityId?: string;
  nextSuggestedAction?: string;
  steps: WorkflowStep[];
  completedAt?: number;
  outcomeId?: string;
}

// ── Step templates ────────────────────────────────────────────────────────────
// nextAction: displayed AFTER this step completes as the next operator task.

export interface StepTemplate {
  id: string;
  label: string;
  nextAction?: string;
}

export const STEP_TEMPLATES: Record<WorkflowCategory, StepTemplate[]> = {
  repair_followup: [
    { id: 'detected',       label: 'Overdue detected',  nextAction: 'Contact customer about overdue repair' },
    { id: 'contacted',      label: 'Customer contacted', nextAction: 'Follow up — repair waiting for pickup' },
    { id: 'waiting_pickup', label: 'Waiting pickup',     nextAction: 'Confirm pickup with customer' },
    { id: 'picked_up',      label: 'Picked up' },
  ],
  collection: [
    { id: 'detected',        label: 'Balance overdue',    nextAction: 'Contact customer about outstanding balance' },
    { id: 'contacted',       label: 'Customer contacted', nextAction: 'Send payment reminder' },
    { id: 'payment_pending', label: 'Payment pending',    nextAction: 'Confirm payment received' },
    { id: 'paid',            label: 'Paid' },
  ],
  vip_retention: [
    { id: 'detected',  label: 'Inactive VIP detected', nextAction: 'Send personalized outreach to VIP customer' },
    { id: 'outreach',  label: 'Outreach attempted',    nextAction: 'Follow up if no response within 3 days' },
    { id: 'returned',  label: 'Customer returned' },
  ],
  inventory_action: [
    { id: 'detected',    label: 'Low stock detected', nextAction: 'Place reorder for item' },
    { id: 'ordered',     label: 'Reorder placed',     nextAction: 'Confirm stock received' },
    { id: 'replenished', label: 'Stock replenished' },
  ],
  approval_review: [
    { id: 'pending',   label: 'Pending review', nextAction: 'Review and approve or dismiss' },
    { id: 'reviewed',  label: 'Reviewed',       nextAction: 'Confirm action taken' },
    { id: 'resolved',  label: 'Resolved' },
  ],
};

// ── INTELLIGENCE-OPERATIONAL-WORKFLOW-SESSIONS-V1 ─────────────────────────────
// Chat-driven session types — distinct from store-backed OperationalWorkflow.

export type WorkflowStepKind =
  | 'detect_entity'
  | 'navigate_to_entity'
  | 'confirm_amount'
  | 'send_message'
  | 'confirm_action'
  | 'complete';

export type OperationalWorkflowType =
  | 'payment_collection'
  | 'repair_followup'
  | 'customer_outreach'
  | 'inventory_promotion';

export interface WorkflowSession {
  id: string;
  type: OperationalWorkflowType;
  currentStepIndex: number;
  steps: WorkflowStepKind[];
  entityKind?: string;
  entityId?: string;
  entityName?: string;
  entityPhone?: string;
  amountCents?: number;
  createdAt: number;
  expiresAt: number;
  completed: boolean;
}
