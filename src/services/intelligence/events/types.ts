// R-OPERATOR-EVENTS-V1 — Operational event types.
// Session-only; no persistence, no cloud, no UI yet.

export type OperatorEventType =
  | 'entity_resolved'
  | 'action_requested'
  | 'execution_request_created'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_rejected'
  | 'action_blocked'
  | 'action_ready';

export type OperatorEvent = {
  id: string;
  type: OperatorEventType;
  source: 'intelligence';
  entityType?: string;
  entityId?: string;
  actionKey?: string;
  requestId?: string;
  approvalId?: string;
  status?: string;
  message?: string;
  createdAt: number;
};
