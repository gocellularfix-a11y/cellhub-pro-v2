import type { BusinessStrategyFocus, StrategyInput } from './businessStrategyTypes';
import {
  ruleWorkflowStabilization,
  ruleCollectionFocus,
  ruleRepairCleanupFocus,
  ruleRecoveryFocus,
  ruleCustomerRetentionFocus,
  ruleUpsellFocus,
} from './businessStrategyRules';

const BALANCED: Omit<BusinessStrategyFocus, 'generatedAt'> = {
  type: 'balanced_operations',
  title: 'Store operating normally',
  priority: 1,
  confidence: 'high',
  suggestionKind: 'operational',
};

/**
 * Compute the single dominant business strategy focus for the current store state.
 * Returns `balanced_operations` when no rule fires (threshold not met).
 * Pure function — safe inside useMemo.
 */
export function computeBusinessStrategy(input: StrategyInput): BusinessStrategyFocus {
  const now = Date.now();
  const candidates = [
    ruleWorkflowStabilization(input, now),
    ruleCollectionFocus(input, now),
    ruleRepairCleanupFocus(input, now),
    ruleRecoveryFocus(input, now),
    ruleCustomerRetentionFocus(input, now),
    ruleUpsellFocus(input, now),
  ].filter((s): s is BusinessStrategyFocus => s !== null);

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? { ...BALANCED, generatedAt: now };
}
