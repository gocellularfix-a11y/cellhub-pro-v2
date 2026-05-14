import type { ReasoningInput, OperationalReasoningConclusion } from './reasoningTypes';
import {
  ruleCriticalCustomerRecovery,
  ruleOperationalOverload,
  ruleCollectionEscalation,
  ruleRevenueRecoveryWindow,
  ruleUpsellMomentum,
  ruleWorkflowStabilityRisk,
} from './reasoningRules';

const MAX_CONCLUSIONS = 3;

export function computeReasoningConclusions(input: ReasoningInput): OperationalReasoningConclusion[] {
  const out: OperationalReasoningConclusion[] = [];
  const rules = [
    ruleCriticalCustomerRecovery,
    ruleCollectionEscalation,
    ruleOperationalOverload,
    ruleRevenueRecoveryWindow,
    ruleWorkflowStabilityRisk,
    ruleUpsellMomentum,
  ];
  for (const rule of rules) {
    try {
      const result = rule(input);
      if (result) out.push(result);
    } catch { /* non-fatal */ }
  }
  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_CONCLUSIONS);
}
