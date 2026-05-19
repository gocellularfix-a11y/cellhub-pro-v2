// INTELLIGENCE-OPERATOR-MISSION-ENGINE-V1
// Pure types — no imports from store, React, or I/O.

import type { ExecutionPayload } from '../execution/types';

export type OperatorMissionType =
  | 'collect_payment'
  | 'repair_followup'
  | 'customer_outreach'
  | 'inventory_promotion'
  | 'slow_day_recovery'
  | 'approval_needed'
  | 'workflow_resume';

export interface OperatorMission {
  id: string;
  type: OperatorMissionType;
  title: string;
  reason: string;
  priority: number;             // 0–100
  estimatedImpactCents?: number;
  entityKind?: string;
  entityId?: string;
  entityName?: string;
  entityPhone?: string;
  workflowId?: string;
  actionLabel: string;
  executionPayload?: ExecutionPayload;
}
