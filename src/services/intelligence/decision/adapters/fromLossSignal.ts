// R-INTELLIGENCE-DECISION-LAYER-F1: LossSignal → IntelligenceDecision adapter.
import type { LossSignal, LossCategory } from '@/services/intelligence/chat/whatIsLosingMoney';
import type { IntelligenceDecision, DecisionDomain, DecisionEntityRef } from '../IntelligenceDecision';
import { clampScore, urgencyFromScore, deriveSecondarySafe } from '../derive';

const DOMAIN_BY_CATEGORY: Record<LossCategory, DecisionDomain> = {
  dead_stock: 'inventory',
  attachment_low: 'marketing',
  repairs_stalled: 'repair',
  layaway_abandoned: 'cash',
  ext_payment_risk: 'cash',
  low_margin_items: 'inventory',
  store_credit_liability: 'cash',
};

export function fromLossSignal(signal: LossSignal): IntelligenceDecision {
  const score = clampScore(signal.score);
  const entityRef: DecisionEntityRef | undefined = signal.entityRef
    ? { type: signal.entityRef.type, id: signal.entityRef.value }
    : undefined;
  return {
    id: `loss:${signal.id}`,
    domain: DOMAIN_BY_CATEGORY[signal.category],
    observation: signal.evidence,
    reasoning: signal.headline,
    decision: signal.recommendedAction,
    confidence: score,
    confidenceBasis: 'from-score',
    score,
    impactCents: signal.exposureCents,
    urgency: urgencyFromScore(score),
    entityRef,
    actionPlan: { steps: [signal.recommendedAction], actions: signal.actions },
    // Only the explicitly margin-defined category surfaces owner-only figures.
    financialSensitive: signal.category === 'low_margin_items',
    safeToRunOnSecondary: deriveSecondarySafe(signal.actions),
    source: { kind: 'loss', signal },
  };
}
