// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F0: shared deterministic derivation helpers.
// Pure functions only — no Date.now(), no randomness, no I/O. Same input →
// same output. Used by the per-signal adapters in ./adapters.
// ============================================================

import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import type { DecisionUrgency } from './IntelligenceDecision';

/** Clamp any number to an integer in [0, 100]; non-finite → 0. */
export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

const CATEGORICAL_CONFIDENCE: Record<'high' | 'medium' | 'low', number> = {
  high: 90,
  medium: 60,
  low: 30,
};

/** Map a categorical confidence ('high'|'medium'|'low') → 90|60|30. */
export function confidenceFromCategorical(c: 'high' | 'medium' | 'low'): number {
  return CATEGORICAL_CONFIDENCE[c];
}

/** Map a unit-interval confidence (0..1, ProactiveAction) → 0..100. */
export function confidenceFromUnit(c: number): number {
  return clampScore((Number.isFinite(c) ? c : 0) * 100);
}

const PRIORITY_SCORE: Record<'critical' | 'high' | 'medium', number> = {
  critical: 90,
  high: 60,
  medium: 30,
};

/** Map a categorical priority → a numeric score (ProactiveAction has no score field). */
export function scoreFromPriority(p: 'critical' | 'high' | 'medium'): number {
  return PRIORITY_SCORE[p];
}

/** Derive an urgency band from a 0..100 score (for signals with no native urgency). */
export function urgencyFromScore(score: number): DecisionUrgency {
  const s = clampScore(score);
  if (s >= 75) return 'critical';
  if (s >= 50) return 'high';
  if (s >= 25) return 'medium';
  return 'low';
}

/**
 * A decision is safe to auto-surface on a secondary terminal only when its
 * action plan contains no side-effecting actions. ChatActionUI carries a
 * defined `actionType` only for mutating / outbound actions (whatsapp, discount,
 * bundle, reminder, review); pure navigation/open actions leave it undefined.
 * An empty action list is vacuously safe.
 */
export function deriveSecondarySafe(actions: ChatActionUI[]): boolean {
  return actions.every((a) => a.actionType === undefined);
}
