import type { OperationalReasoningConclusion } from './reasoningTypes';

export function getTopConclusion(conclusions: OperationalReasoningConclusion[]): OperationalReasoningConclusion | null {
  return conclusions[0] ?? null;
}

export function hasConclusion(conclusions: OperationalReasoningConclusion[], type: OperationalReasoningConclusion['type']): boolean {
  return conclusions.some((c) => c.type === type);
}

// Suggestion IDs suppressed when a given reasoning conclusion is active.
// Keyed by `reasoning_${conclusion.id}` (the suggestion ID format used in contextSuggestions).
export const CONCLUSION_SUPPRESSIONS: Record<string, string[]> = {
  reasoning_critical_customer_recovery: [
    'scoring_vip_retention', 'scoring_churn_high', 'scoring_lost_recovery',
    'rhythm_slow_day', 'rhythm_low_activity', 'retention_inactive',
  ],
  reasoning_operational_overload: [
    'op_repair_delays', 'op_unfinished_workflows', 'op_repairs_ready',
    'rhythm_repair_overload', 'trend_risk_increasing', 'trend_worsening',
  ],
  reasoning_collection_escalation: [
    'rhythm_collection_mode', 'trend_slowing',
    'scoring_collection_high', 'scoring_collection_medium',
  ],
  reasoning_revenue_recovery_window: [
    'rhythm_slow_day', 'rhythm_opportunity_window', 'rhythm_revenue_recovery',
    'trend_slowing', 'trend_recovering',
  ],
  reasoning_upsell_momentum: [
    'op_accessory_attach_opportunity', 'upsell_opportunity',
    'upsell_accessories_phonepay', 'trend_accelerating', 'trend_improving',
  ],
  reasoning_workflow_stability_risk: [
    'op_unfinished_workflows', 'trend_workflow_accumulating',
  ],
};
