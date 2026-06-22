// R-INTELLIGENCE-DECISION-LAYER-F1: DiagnosisCause → IntelligenceDecision adapter.
import type { DiagnosisCause, DiagnosisCategory } from '@/services/intelligence/chat/whyIsTodaySlow';
import type { IntelligenceDecision, DecisionDomain } from '../IntelligenceDecision';
import { clampScore, confidenceFromCategorical, urgencyFromScore, deriveSecondarySafe } from '../derive';

const DOMAIN_BY_CATEGORY: Record<DiagnosisCategory, DecisionDomain> = {
  traffic: 'ops',
  conversion: 'ops',
  repairs_intake: 'repair',
  repairs_pickup: 'repair',
  phone_payments: 'cash',
  inventory: 'inventory',
  activity: 'ops',
};

export function fromDiagnosisCause(signal: DiagnosisCause): IntelligenceDecision {
  const score = clampScore(signal.score);
  return {
    id: `diagnosis:${signal.id}`,
    domain: DOMAIN_BY_CATEGORY[signal.category],
    observation: signal.evidence,
    reasoning: signal.headline,
    decision: signal.recommendedAction,
    confidence: confidenceFromCategorical(signal.confidence),
    confidenceBasis: 'explicit',
    score,
    urgency: urgencyFromScore(score),
    // DiagnosisCause points at no single concrete entity → no entityRef.
    actionPlan: { steps: [signal.recommendedAction], actions: signal.actions },
    financialSensitive: false,
    safeToRunOnSecondary: deriveSecondarySafe(signal.actions),
    source: { kind: 'diagnosis', signal },
  };
}
