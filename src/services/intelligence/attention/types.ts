// R-INTELLIGENCE-ATTENTION-MODEL-V1

export type AttentionState =
  | 'focused'
  | 'busy'
  | 'overloaded'
  | 'idle'
  | 'recovering';

export interface AttentionSnapshot {
  state: AttentionState;
  calculatedAt: number;
  recentDismissals: number;
  recentActions: number;
  recentCheckouts: number;
  unresolvedCriticalCount: number;
  interruptionScore: number; // 0–1
}

export interface AttentionDecision {
  allowSuggestion: boolean;
  reason: string;
  cooldownMultiplier: number;
  maxPriorityAllowed: 'critical' | 'high' | 'medium' | 'low';
}

// ── INTELLIGENCE-OPERATOR-ATTENTION-SYSTEM-V1 ─────────────────────────────────
// Operational mission/workflow attention types.
// DISTINCT from the operator-state types above and from entityPriorityTypes.ts
// (entity-urgency model). This models UNRESOLVED MISSION PRESSURE.

import type { ExecutionPayload } from '../execution/types';

export type AttentionType =
  | 'unfinished_workflow'
  | 'stale_mission'
  | 'overdue_followup'
  | 'missed_collection'
  | 'slow_day_alert'
  | 'approval_waiting';

/** Named OperatorAttentionItem to avoid collision with entityPriorityTypes.AttentionItem. */
export interface OperatorAttentionItem {
  id: string;
  type: AttentionType;
  title: string;
  reason: string;
  severity: number;           // 0–100
  createdAt: number;
  staleMinutes: number;
  entityKind?: string;
  entityId?: string;
  workflowId?: string;
  missionId?: string;
  escalationLevel: 0 | 1 | 2 | 3;
  executionPayload?: ExecutionPayload;
}
