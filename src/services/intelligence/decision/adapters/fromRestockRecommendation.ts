// R-INTELLIGENCE-DECISION-LAYER-F1: RestockRecommendation → IntelligenceDecision adapter.
import type { RestockRecommendation } from '@/services/intelligence/chat/restockOpportunity';
import type { IntelligenceDecision, DecisionEntityRef } from '../IntelligenceDecision';
import { clampScore, urgencyFromScore, deriveSecondarySafe } from '../derive';

export function fromRestockRecommendation(signal: RestockRecommendation): IntelligenceDecision {
  const score = clampScore(signal.score);
  const entityRef: DecisionEntityRef = { type: 'product', id: signal.id, name: signal.name };
  return {
    id: `restock:${signal.id}`,
    domain: 'inventory',
    observation: signal.reason,
    reasoning: signal.reason,
    decision: signal.recommendedAction,
    confidence: score,
    confidenceBasis: 'from-score',
    score,
    // Per-unit margin is the available dollar figure; structured fields
    // (costCents, marginRatio, daysOfCover, …) remain available via source.signal.
    impactCents: signal.marginCents,
    urgency: urgencyFromScore(score),
    entityRef,
    actionPlan: { steps: [signal.recommendedAction], actions: [] },
    // Exposes margin/cost → owner-only.
    financialSensitive: true,
    safeToRunOnSecondary: deriveSecondarySafe([]),
    source: { kind: 'restock', signal },
  };
}
