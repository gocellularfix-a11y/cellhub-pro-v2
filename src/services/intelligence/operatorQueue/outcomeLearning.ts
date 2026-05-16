// ============================================================
// CellHub Intelligence — Operator Queue Outcome Learning
// R-INTELLIGENCE-OUTCOME-LEARNING-V1
//
// Deterministic local feedback loop. Reads terminal (completed /
// dismissed) queue items and calculates per-type effectiveness.
// No ML, no embeddings, no backend, no background workers.
//
// Used to apply a small score adjustment (+/-10 max) and stamp
// a confidence label ('new'|'weak'|'proven'|'strong') on each
// new queue item so the operator has calibration context.
// ============================================================

import { readOperatorQueue } from './operatorQueue';
import type { OperatorTaskType, ConfidenceLabel } from './operatorQueue';

export interface TypeEffectiveness {
  type: OperatorTaskType;
  sampleCount: number;
  completedCount: number;
  dismissedCount: number;
  completionRate: number;   // 0–1
  effectivenessScore: number; // 0–100
  confidenceLabel: ConfidenceLabel;
  insightReason: string;
}

export interface OutcomeAdjustment {
  scoreAdjustment: number;  // -10 to +10
  confidenceLabel: ConfidenceLabel;
  insightReason: string;
}

const TYPE_NAMES: Record<OperatorTaskType, string> = {
  recover_customer:  'Recover customer',
  vip_outreach:      'VIP outreach',
  product_promotion: 'Product promo',
  repair_follow_up:  'Repair follow-up',
  repair_escalate:   'Repair escalation',
  repair_waiting:    'Repair waiting',
};

function confidenceFromSample(n: number): ConfidenceLabel {
  if (n < 3)  return 'new';
  if (n < 10) return 'weak';
  if (n < 25) return 'proven';
  return 'strong';
}

// Reads terminal items from the queue (capped at MAX_TERMINAL_ITEMS=50 per type).
// No separate storage needed — the queue already retains 50 terminal items.
export function getTypeEffectiveness(type: OperatorTaskType): TypeEffectiveness {
  const all = readOperatorQueue();
  const terminal = all.filter((i) => i.type === type && i.status !== 'pending');
  const completedCount = terminal.filter((i) => i.status === 'completed').length;
  const dismissedCount = terminal.filter((i) => i.status === 'dismissed').length;
  const sampleCount = completedCount + dismissedCount;

  // Default to neutral (0.5) when no history — no bias before first data point.
  const completionRate = sampleCount > 0 ? completedCount / sampleCount : 0.5;

  // 80 pts from completion rate + up to 20 pts from sample volume (confidence bonus).
  const effectivenessScore = Math.min(
    100,
    Math.round(completionRate * 80 + Math.min(sampleCount / 10, 1) * 20),
  );

  const confidenceLabel = confidenceFromSample(sampleCount);
  const typeName = TYPE_NAMES[type];

  let insightReason: string;
  if (sampleCount < 3) {
    insightReason = `${typeName} has low history so far`;
  } else if (completionRate >= 0.7) {
    insightReason = `${typeName} is usually completed`;
  } else if (completionRate <= 0.3) {
    insightReason = `${typeName} often gets dismissed`;
  } else {
    insightReason = `${typeName} has mixed outcomes`;
  }

  return {
    type, sampleCount, completedCount, dismissedCount,
    completionRate, effectivenessScore, confidenceLabel, insightReason,
  };
}

// Returns the score adjustment and confidence label to stamp on a new queue item.
// Adjustment is secondary — primary score from priorityScoring.ts always dominates.
export function getOutcomeAdjustment(type: OperatorTaskType): OutcomeAdjustment {
  const eff = getTypeEffectiveness(type);

  if (eff.sampleCount < 3) {
    // Not enough history: no adjustment, no false signals.
    return { scoreAdjustment: 0, confidenceLabel: 'new', insightReason: eff.insightReason };
  }

  // Map effectivenessScore [0–100] → adjustment [-10, +10].
  // Neutral point: 50 → 0. Each 5 pts above/below neutral = ±1 adj.
  const rawAdj = (eff.effectivenessScore - 50) / 5;
  const scoreAdjustment = Math.max(-10, Math.min(10, Math.round(rawAdj)));

  return { scoreAdjustment, confidenceLabel: eff.confidenceLabel, insightReason: eff.insightReason };
}
