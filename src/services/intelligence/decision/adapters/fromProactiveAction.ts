// R-INTELLIGENCE-DECISION-LAYER-F1: ProactiveAction → IntelligenceDecision adapter.
import type { ProactiveAction, ProactiveCategory } from '@/services/intelligence/proactive/types';
import type { IntelligenceDecision, DecisionDomain, DecisionEntityRef } from '../IntelligenceDecision';
import { confidenceFromUnit, scoreFromPriority, deriveSecondarySafe } from '../derive';

const DOMAIN_BY_CATEGORY: Record<ProactiveCategory, DecisionDomain> = {
  collection: 'cash',
  repair_followup: 'repair',
  vip_retention: 'customer',
  inventory: 'inventory',
  approval: 'ops',
  revenue: 'cash',
};

export function fromProactiveAction(signal: ProactiveAction): IntelligenceDecision {
  const entityRef: DecisionEntityRef | undefined =
    signal.entityType && signal.entityId
      ? { type: signal.entityType, id: signal.entityId }
      : undefined;
  return {
    id: `proactive:${signal.id}`,
    domain: DOMAIN_BY_CATEGORY[signal.category],
    observation: signal.reason,
    reasoning: signal.title,
    decision: signal.recommendedAction,
    confidence: confidenceFromUnit(signal.confidence),
    confidenceBasis: 'explicit',
    // ProactiveAction has no numeric score — derive from its categorical priority.
    score: scoreFromPriority(signal.priority),
    impactCents: signal.estimatedImpactCents,
    // priority ('critical'|'high'|'medium') is a subset of DecisionUrgency.
    urgency: signal.priority,
    entityRef,
    actionPlan: { steps: [signal.recommendedAction], actions: [], workflowId: signal.workflowId },
    financialSensitive: false,
    safeToRunOnSecondary: deriveSecondarySafe([]),
    source: { kind: 'proactive', signal },
  };
}
