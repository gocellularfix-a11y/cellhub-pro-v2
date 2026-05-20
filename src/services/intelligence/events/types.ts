// R-OPERATOR-EVENTS-V1 — Operational event types.
// Session-only; no persistence, no cloud, no UI yet.

export type OperatorEventSeverity =
  | 'info'
  | 'success'
  | 'warning';

export type OperatorEventType =
  | 'entity_resolved'
  | 'action_requested'
  | 'execution_request_created'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_rejected'
  | 'action_blocked'
  | 'action_ready'
  | 'workflow_created'
  | 'workflow_updated'
  | 'workflow_step_added'
  | 'workflow_step_updated'
  | 'workflow_completed'
  | 'workflow_blocked';

export type WorkflowEventType =
  | 'workflow_created'
  | 'workflow_updated'
  | 'workflow_step_added'
  | 'workflow_step_updated'
  | 'workflow_completed'
  | 'workflow_blocked';

export type WorkflowEventPayload = {
  workflowId?: string;
  workflowStatus?: string;
  stepId?: string;
  stepKind?: string;
  stepStatus?: string;
};

export type OperatorEvent = WorkflowEventPayload & {
  id: string;
  type: OperatorEventType;
  source: 'intelligence';
  severity?: OperatorEventSeverity;
  entityType?: string;
  entityId?: string;
  actionKey?: string;
  requestId?: string;
  approvalId?: string;
  status?: string;
  message?: string;
  createdAt: number;
};
