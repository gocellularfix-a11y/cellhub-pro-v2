import type { BusinessStrategyFocus, StrategyType } from './businessStrategyTypes';

const LABELS: Record<StrategyType, string> = {
  workflow_stabilization_focus: 'Stabilize workflows',
  collection_focus:             'Prioritize balance recovery',
  repair_cleanup_focus:         'Clear repair backlog',
  recovery_focus:               'Focus on customer recovery',
  customer_retention_focus:     'Protect high-value customers',
  upsell_focus:                 'Push accessory opportunities',
  balanced_operations:          '',
};

/** Short badge label for the bubble preview strip (≤ 36 chars). */
export function getStrategyLabel(type: StrategyType): string {
  return LABELS[type] ?? '';
}

/** True when the strategy is non-balanced and worth surfacing. */
export function isStrategyActionable(strategy: BusinessStrategyFocus): boolean {
  return strategy.type !== 'balanced_operations';
}

// Suggestion IDs suppressed when a given strategy is active.
// Keyed by `strategy_${strategy.type}` (the suggestion ID format).
export const STRATEGY_SUPPRESSIONS: Record<string, string[]> = {
  strategy_workflow_stabilization_focus: ['op_unfinished_workflows', 'reasoning_workflow_stability_risk'],
  strategy_collection_focus:             ['scoring_collection_high', 'scoring_collection_medium', 'rhythm_collection_mode', 'trend_slowing', 'reasoning_collection_escalation'],
  strategy_repair_cleanup_focus:         ['op_repair_delays', 'op_repairs_ready', 'rhythm_repair_overload', 'trend_risk_increasing', 'reasoning_operational_overload'],
  strategy_recovery_focus:               ['retention_inactive', 'scoring_churn_high', 'scoring_churn_medium', 'rhythm_slow_day', 'rhythm_low_activity'],
  strategy_customer_retention_focus:     ['retention_inactive', 'scoring_vip_retention'],
  strategy_upsell_focus:                 ['upsell_opportunity', 'upsell_accessories_phonepay', 'op_accessory_attach_opportunity', 'reasoning_upsell_momentum'],
  strategy_balanced_operations:          [],
};
