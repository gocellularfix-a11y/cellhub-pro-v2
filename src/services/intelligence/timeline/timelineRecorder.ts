// INTELLIGENCE-OPERATOR-TIMELINE-V1
// Typed recording helpers. Call-site-friendly — callers pass domain objects,
// helpers shape them into OperatorTimelineEvent and delegate to the store.

import { generateId } from '@/utils/dates';
import { recordTimelineEvent, getTimelineEvents } from './timelineStore';
import type { OperatorTimelineEvent } from './types';
import type { OperatorAttentionItem } from '../attention/types';
import type { OperatorMission } from '../missions/types';
import type { WorkflowSession } from '../workflows/types';
import type { OperatorEvent, OperatorEventSeverity } from '../events/types';
import { subscribeOperatorEvents } from '../events/operatorEventBus';

function evt(fields: Omit<OperatorTimelineEvent, 'id' | 'createdAt'>): OperatorTimelineEvent {
  return { id: generateId(), createdAt: Date.now(), ...fields };
}

export function recordMissionShown(mission: OperatorMission): void {
  recordTimelineEvent(evt({
    type:        'mission_shown',
    title:       mission.title,
    description: mission.reason,
    entityKind:  mission.entityKind,
    entityId:    mission.entityId,
    entityName:  mission.entityName,
    missionId:   mission.id,
    impactCents: mission.estimatedImpactCents,
  }));
}

export function recordAttentionShown(item: OperatorAttentionItem): void {
  recordTimelineEvent(evt({
    type:        'attention_shown',
    title:       item.title,
    description: item.reason,
    entityKind:  item.entityKind,
    entityId:    item.entityId,
    workflowId:  item.workflowId,
    missionId:   item.missionId,
    severity:    item.severity,
  }));
}

export function recordWorkflowStarted(session: WorkflowSession): void {
  recordTimelineEvent(evt({
    type:       'workflow_started',
    title:      session.type,
    entityKind: session.entityKind,
    entityId:   session.entityId,
    entityName: session.entityName,
    workflowId: session.id,
  }));
}

export function recordWorkflowContinued(session: WorkflowSession): void {
  recordTimelineEvent(evt({
    type:       'workflow_continued',
    title:      session.type,
    entityKind: session.entityKind,
    entityId:   session.entityId,
    entityName: session.entityName,
    workflowId: session.id,
  }));
}

export function recordWorkflowCompleted(session: WorkflowSession, description?: string): void {
  recordTimelineEvent(evt({
    type:        'workflow_completed',
    title:       session.type,
    description,
    entityKind:  session.entityKind,
    entityId:    session.entityId,
    entityName:  session.entityName,
    workflowId:  session.id,
  }));
}

export function recordActionSuggested(label: string, actionKey?: string, entityId?: string, entityName?: string): void {
  recordTimelineEvent(evt({
    type:       'action_suggested',
    title:      label,
    action:     actionKey,
    entityId,
    entityName,
  }));
}

export function recordActionClicked(label: string, actionKey?: string, entityId?: string, entityName?: string): void {
  recordTimelineEvent(evt({
    type:       'action_clicked',
    title:      label,
    action:     actionKey,
    entityId,
    entityName,
  }));
}

// ── R-WORKFLOW-TIMELINE-BRIDGE-V1 ─────────────────────────────────────────────

const _CHAIN_TIMELINE_TYPE = {
  workflow_created:      'workflow_chain_created',
  workflow_updated:      'workflow_chain_updated',
  workflow_step_added:   'workflow_chain_step_added',
  workflow_step_updated: 'workflow_chain_step_updated',
  workflow_completed:    'workflow_chain_completed',
  workflow_blocked:      'workflow_chain_blocked',
} as const satisfies Record<string, OperatorTimelineEvent['type']>;

const _CHAIN_TITLE: Record<keyof typeof _CHAIN_TIMELINE_TYPE, string> = {
  workflow_created:      'Workflow created',
  workflow_updated:      'Workflow updated',
  workflow_step_added:   'Workflow step added',
  workflow_step_updated: 'Workflow step updated',
  workflow_completed:    'Workflow completed',
  workflow_blocked:      'Workflow blocked',
};

const _SEVERITY_NUM: Record<OperatorEventSeverity, number> = {
  info:    0,
  success: 1,
  warning: 2,
};

/**
 * Records a workflow chain OperatorEvent into the operator timeline.
 * Dedupes by deterministic id `timeline-${event.id}` — idempotent.
 * No-ops for non-workflow event types.
 */
export function recordWorkflowChainEvent(event: OperatorEvent): void {
  const typeKey = event.type as keyof typeof _CHAIN_TIMELINE_TYPE;
  if (!(typeKey in _CHAIN_TIMELINE_TYPE)) return;

  const timelineId = `timeline-${event.id}`;
  if (getTimelineEvents().some(e => e.id === timelineId)) return;

  recordTimelineEvent({
    id:         timelineId,
    type:       _CHAIN_TIMELINE_TYPE[typeKey],
    title:      _CHAIN_TITLE[typeKey],
    workflowId: event.workflowId,
    severity:   event.severity !== undefined ? _SEVERITY_NUM[event.severity] : undefined,
    createdAt:  event.createdAt,
  });
}

// ── R-WORKFLOW-TIMELINE-DECOUPLING-V1 ─────────────────────────────────────────

let _workflowBridgeInitialized = false;

/**
 * Subscribes the workflow → timeline bridge to the operator event bus.
 * Idempotent — safe to call multiple times; only the first call registers.
 * Auto-invoked at module load so no explicit wiring is required at call sites.
 */
export function initializeWorkflowTimelineBridge(): void {
  if (_workflowBridgeInitialized) return;
  _workflowBridgeInitialized = true;
  subscribeOperatorEvents(recordWorkflowChainEvent);
}

// Auto-initialize on module load. Guard above prevents duplicate subscription
// if external callers also invoke initializeWorkflowTimelineBridge().
initializeWorkflowTimelineBridge();
