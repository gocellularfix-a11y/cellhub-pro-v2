// R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1
// Proactive operational action types — no imports from store or React.

export type ProactiveCategory =
  | 'collection'
  | 'repair_followup'
  | 'vip_retention'
  | 'inventory'
  | 'approval'
  | 'revenue';

export interface ProactiveAction {
  id: string;

  category: ProactiveCategory;

  priority: 'critical' | 'high' | 'medium';

  title: string;
  reason: string;
  recommendedAction: string;

  estimatedImpactCents?: number;

  entityType?: string;
  entityId?: string;

  workflowId?: string;

  confidence: number; // 0–1 deterministic confidence score

  createdAt: number;
}

export interface ProactiveOperationsReport {
  generatedAt: number;

  summary: string;

  actions: ProactiveAction[];

  topAction?: ProactiveAction;
}
