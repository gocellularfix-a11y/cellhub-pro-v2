import type { ActionChain, ChainInput } from './actionChainTypes';
import {
  ruleWorkflowStabilization,
  ruleCollectionRecovery,
  ruleRepairCleanup,
  ruleVipCustomerRecovery,
  ruleUpsellMomentum,
} from './actionChainRules';

/**
 * Compute the single dominant action chain for the current store state.
 * Returns null when no rule fires — no chain to surface.
 * Pure function — safe inside useMemo.
 */
export function computeActiveChain(input: ChainInput): ActionChain | null {
  const now = Date.now();
  const candidates = [
    ruleWorkflowStabilization(input, now),
    ruleCollectionRecovery(input, now),
    ruleRepairCleanup(input, now),
    ruleVipCustomerRecovery(input, now),
    ruleUpsellMomentum(input, now),
  ].filter((c): c is ActionChain => c !== null);

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}
