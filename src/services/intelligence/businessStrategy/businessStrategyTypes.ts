export type StrategyType =
  | 'collection_focus'
  | 'recovery_focus'
  | 'repair_cleanup_focus'
  | 'upsell_focus'
  | 'workflow_stabilization_focus'
  | 'customer_retention_focus'
  | 'balanced_operations';

export interface BusinessStrategyFocus {
  type: StrategyType;
  title: string;
  detail?: string;
  priority: number;
  confidence: 'high' | 'medium' | 'low';
  suggestionKind: 'upsell' | 'follow_up' | 'collect' | 'retention' | 'operational';
  generatedAt: number;
}

// Primitive-only input — avoids circular imports from employeeOpsTypes.
export interface StrategyInput {
  rhythmMode: string;
  trendMode: string;
  overdueRepairCount: number;
  overdueLayawayCount: number;
  activeWorkflowCount: number;
  salesMomentumScore: number;
  collectionMomentumScore: number;
  workflowMomentumScore: number;
  revenueOpportunityCount: number;
  revenueOpportunityTypes: string[];
  conclusionTypes: string[];
  signalIds: string[];
}
