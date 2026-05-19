// INTELLIGENCE-OPERATOR-TIMELINE-V1
// Read-only selectors. Pure functions — no side effects.

import { getTimelineEvents } from './timelineStore';
import type { OperatorTimelineEvent } from './types';

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** All events from today (midnight to now), newest first. */
export function getTodayTimeline(): OperatorTimelineEvent[] {
  const cutoff = todayStart();
  return getTimelineEvents()
    .filter(e => e.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Latest N events across all days, newest first. */
export function getRecentTimeline(limit = 20): OperatorTimelineEvent[] {
  const events = getTimelineEvents();
  return events
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export interface TimelineSummary {
  totalEventsToday: number;
  actionsClickedToday: number;
  workflowsCompletedToday: number;
  attentionItemsShownToday: number;
  estimatedImpactCentsToday: number;
}

export function getTimelineSummary(): TimelineSummary {
  const today = getTodayTimeline();
  return {
    totalEventsToday:          today.length,
    actionsClickedToday:       today.filter(e => e.type === 'action_clicked').length,
    workflowsCompletedToday:   today.filter(e => e.type === 'workflow_completed').length,
    attentionItemsShownToday:  today.filter(e => e.type === 'attention_shown').length,
    estimatedImpactCentsToday: today.reduce((sum, e) => sum + (e.impactCents ?? 0), 0),
  };
}
