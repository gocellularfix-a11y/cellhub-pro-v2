export type ReasoningConclusionType =
  | 'critical_customer_recovery'
  | 'operational_overload'
  | 'collection_escalation'
  | 'revenue_recovery_window'
  | 'upsell_momentum'
  | 'workflow_stability_risk';

export interface OperationalReasoningConclusion {
  id: ReasoningConclusionType;
  type: ReasoningConclusionType;
  title: string;
  detail?: string;
  priority: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  recommendedActions: string[];
  relatedModules: string[];
  suggestionKind: 'upsell' | 'follow_up' | 'collect' | 'retention' | 'operational';
  generatedAt: number;
}

export interface ReasoningInput {
  rhythmMode: string;
  trendMode: string;
  salesMomentumScore: number;
  collectionMomentumScore: number;
  workflowMomentumScore: number;
  activeWorkflowCount: number;
  overdueRepairCount: number;
  overdueLayawayCount: number;
  revenueOpportunityTypes: string[];
  revenueOpportunityCount: number;
  signalIds: string[];
}
