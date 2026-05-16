// R-INTELLIGENCE-DECISION-RECOMMENDATION-V1
// Strategic decision recommendation types.
// Translates detected conditions into best operational moves.
// Deterministic — no ML, no AI APIs.

export type DecisionCategory =
  | 'recover_revenue'
  | 'protect_operations'
  | 'increase_sales'
  | 'reduce_overload'
  | 'protect_inventory'
  | 'retain_customers';

export interface DecisionRecommendation {
  id: string;

  category: DecisionCategory;

  priority: 'critical' | 'high' | 'medium';

  title: string;

  reasoning: string;

  recommendedMove: string;

  expectedBenefit?: string;

  relatedConditionId?: string;

  entityType?: string;
  entityId?: string;

  confidence: number;

  createdAt: number;
}

export interface DecisionRecommendationReport {
  generatedAt: number;

  summary: string;

  recommendations: DecisionRecommendation[];

  topRecommendation?: DecisionRecommendation;
}
