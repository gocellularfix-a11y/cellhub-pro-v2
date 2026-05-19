// INTELLIGENCE-OPERATOR-TIMELINE-V1
// Typed recording helpers. Call-site-friendly — callers pass domain objects,
// helpers shape them into OperatorTimelineEvent and delegate to the store.

import { generateId } from '@/utils/dates';
import { recordTimelineEvent } from './timelineStore';
import type { OperatorTimelineEvent } from './types';
import type { OperatorAttentionItem } from '../attention/types';
import type { OperatorMission } from '../missions/types';
import type { WorkflowSession } from '../workflows/types';

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
