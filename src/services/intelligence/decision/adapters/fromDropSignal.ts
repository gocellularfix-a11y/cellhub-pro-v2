// R-INTELLIGENCE-DECISION-LAYER-F1: DropSignal → IntelligenceDecision adapter.
import type { DropSignal, DropSignalCategory } from '@/services/intelligence/chat/whyDidSalesDrop';
import type { IntelligenceDecision, DecisionDomain, DecisionEntityRef } from '../IntelligenceDecision';
import { clampScore, confidenceFromCategorical, deriveSecondarySafe } from '../derive';

const DOMAIN_BY_CATEGORY: Record<DropSignalCategory, DecisionDomain> = {
  overall_revenue: 'cash',
  category_drop: 'cash',
  customer_disappearance: 'customer',
  accessory_attach_drop: 'marketing',
  activation_decline: 'marketing',
  repair_decline: 'repair',
  employee_decline: 'ops',
  product_movement_decline: 'inventory',
};

export function fromDropSignal(signal: DropSignal): IntelligenceDecision {
  const entityRef: DecisionEntityRef | undefined = signal.entityRef
    ? { type: signal.entityRef.type, id: signal.entityRef.value }
    : undefined;
  return {
    id: `drop:${signal.id}`,
    domain: DOMAIN_BY_CATEGORY[signal.category],
    observation: signal.evidence,
    reasoning: signal.headline,
    decision: signal.recommendedAction,
    confidence: confidenceFromCategorical(signal.confidence),
    confidenceBasis: 'explicit',
    score: clampScore(signal.score),
    impactCents: signal.estimatedImpactCents,
    // DropSeverity is structurally identical to DecisionUrgency.
    urgency: signal.severity,
    entityRef,
    actionPlan: { steps: [signal.recommendedAction], actions: signal.actions },
    // Revenue/count figures are visible to all roles → not owner-sensitive.
    financialSensitive: false,
    safeToRunOnSecondary: deriveSecondarySafe(signal.actions),
    source: { kind: 'drop', signal },
  };
}
