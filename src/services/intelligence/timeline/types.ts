// INTELLIGENCE-OPERATOR-TIMELINE-V1
// Deterministic operational event types.
// No AI, no LLM, no embeddings, no background workers.

export type OperatorTimelineEventType =
  | 'mission_shown'
  | 'attention_shown'
  | 'workflow_started'
  | 'workflow_continued'
  | 'workflow_completed'
  | 'action_suggested'
  | 'action_clicked'
  | 'entity_opened'
  // R-WORKFLOW-TIMELINE-BRIDGE-V1 — operational workflow chain events
  | 'workflow_chain_created'
  | 'workflow_chain_updated'
  | 'workflow_chain_step_added'
  | 'workflow_chain_step_updated'
  | 'workflow_chain_completed'
  | 'workflow_chain_blocked';

export interface OperatorTimelineEvent {
  id: string;
  type: OperatorTimelineEventType;
  title: string;
  description?: string;
  entityKind?: string;
  entityId?: string;
  entityName?: string;
  workflowId?: string;
  missionId?: string;
  action?: string;
  severity?: number;
  impactCents?: number;
  createdAt: number;
}
