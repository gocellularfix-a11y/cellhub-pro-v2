// R-INTELLIGENCE-DECISION-LAYER-F1: AttentionItem → IntelligenceDecision adapter.
import type { AttentionItem, AttentionDomain } from '@/services/intelligence/chat/whoNeedsAttentionToday';
import type { IntelligenceDecision, DecisionDomain, DecisionEntityRef } from '../IntelligenceDecision';
import { clampScore, deriveSecondarySafe } from '../derive';

const DOMAIN_BY_ATTENTION: Record<AttentionDomain, DecisionDomain> = {
  repair: 'repair',
  layaway: 'cash',
  external_payment: 'cash',
  customer_churn: 'customer',
  store_credit: 'cash',
  special_order: 'ops',
};

export function fromAttentionItem(signal: AttentionItem): IntelligenceDecision {
  const score = clampScore(signal.priorityScore);
  const entityRef: DecisionEntityRef = {
    type: signal.domain,
    id: signal.entityId,
    name: signal.customerName ?? signal.entityName,
    phone: signal.customerPhone,
    customerId: signal.customerId,
  };
  return {
    id: `attention:${signal.id}`,
    domain: DOMAIN_BY_ATTENTION[signal.domain],
    observation: signal.reason,
    reasoning: signal.reason,
    decision: signal.recommendedAction,
    confidence: score,
    confidenceBasis: 'from-score',
    score,
    // AttentionUrgency is structurally identical to DecisionUrgency.
    urgency: signal.urgency,
    entityRef,
    // AttentionItem carries no executable UI actions of its own.
    actionPlan: { steps: [signal.recommendedAction], actions: [] },
    financialSensitive: false,
    safeToRunOnSecondary: deriveSecondarySafe([]),
    source: { kind: 'attention', signal },
  };
}
