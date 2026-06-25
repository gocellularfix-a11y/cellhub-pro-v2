// ============================================================
// R-INTEL-LEARNING-WIRE: bounded advisory learning adjustment for ranking.
//
// Turns the already-wired operator feedback signal (feedback/scoring buildScoreMap
// — which also receives outcome-driven feedback via recordOutcomeFeedback) into a
// per-entity, bounded modifier applied to a ScoredDecision's priority AFTER the
// base score is computed and BEFORE sorting.
//
// Pure + deterministic: no Date, no randomness, no I/O, no mutation of inputs. The
// impure feedback read lives in the getTopActionsToday wrapper. Fail-safe: any
// missing/malformed learning data leaves ranking unchanged.
//
// Bounds (the structural guards against ranking drift):
//   • Every modifier is clamped to [-MAX, +MAX] (reuses MAX_ABSOLUTE_LEARNING_MODIFIER = 0.10).
//   • Repeated feedback can only push the per-entity aggregate to the cap, never beyond.
//   • Critical decisions are NEVER demoted by negative learning (they must still surface).
// ============================================================

import type { ScoredDecision } from '../ranking/scoreDecision';
import { MAX_ABSOLUTE_LEARNING_MODIFIER } from './LearningInfluence';

/** Hard cap on any single advisory learning modifier. */
export const LEARNING_MODIFIER_CAP = MAX_ABSOLUTE_LEARNING_MODIFIER; // 0.10

// buildScoreMap clamps each fingerprint's score to [-10, +10]; we treat that as
// the span that maps linearly onto [-CAP, +CAP].
const FEEDBACK_SCORE_SPAN = 10;

// Manager-queue fingerprint shape: `category|entityType|entityId|normalizedTitle`.
// entityId is the third segment. Aligns with IntelligenceDecision.entityRef.id.
const FINGERPRINT_ENTITY_INDEX = 2;

/**
 * Reduce a feedback score map (Map<fingerprint, score∈[-10,+10]>) to a per-entity
 * advisory modifier map (Map<entityId, modifier∈[-0.10,+0.10]>).
 *
 * A single entity may carry several fingerprints (different titles/categories);
 * their scores are summed, re-clamped to the feedback span, then scaled to the
 * modifier cap. Fail-safe: null/garbage input → empty map (no learning).
 */
export function buildEntityLearningModifiers(
  feedbackScoreMap: Map<string, number> | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!feedbackScoreMap || typeof feedbackScoreMap.forEach !== 'function') return out;

  const byEntity = new Map<string, number>();
  feedbackScoreMap.forEach((score, fingerprint) => {
    if (typeof fingerprint !== 'string' || !Number.isFinite(score)) return;
    const parts = fingerprint.split('|');
    const entityId = parts[FINGERPRINT_ENTITY_INDEX];
    if (!entityId) return; // no concrete entity → cannot target a decision
    byEntity.set(entityId, (byEntity.get(entityId) ?? 0) + score);
  });

  for (const [entityId, raw] of byEntity) {
    const clampedScore = Math.max(-FEEDBACK_SCORE_SPAN, Math.min(FEEDBACK_SCORE_SPAN, raw));
    const modifier = (clampedScore / FEEDBACK_SCORE_SPAN) * LEARNING_MODIFIER_CAP;
    if (modifier !== 0) out.set(entityId, modifier);
  }
  return out;
}

/** Clamp a modifier into the hard bound (defensive — input is usually pre-bounded). */
function clampModifier(m: number): number {
  if (!Number.isFinite(m)) return 0;
  if (m > LEARNING_MODIFIER_CAP) return LEARNING_MODIFIER_CAP;
  if (m < -LEARNING_MODIFIER_CAP) return -LEARNING_MODIFIER_CAP;
  return m;
}

/**
 * Apply per-entity advisory modifiers to scored decisions. Returns a NEW array;
 * never mutates inputs. Decisions with no matching entity (or no learning data)
 * pass through unchanged.
 *
 *   adjustedPriority = round(basePriority * (1 + modifier))
 *
 * Critical-urgency decisions are protected: a negative modifier is ignored so a
 * critical risk is never demoted by historical feedback. Positive boosts still
 * apply (they only help a critical surface).
 */
export function applyLearningInfluence(
  scored: ScoredDecision[],
  modifiers: Map<string, number> | null | undefined,
): ScoredDecision[] {
  if (!Array.isArray(scored) || scored.length === 0) return scored ?? [];
  if (!modifiers || typeof modifiers.get !== 'function' || modifiers.size === 0) return scored;

  return scored.map((s) => {
    try {
      const entityId = s.decision?.entityRef?.id;
      if (!entityId) return s;
      let modifier = modifiers.get(entityId) ?? 0;
      if (!Number.isFinite(modifier) || modifier === 0) return s;
      // Critical risks must still surface — never demote them.
      if (s.decision.urgency === 'critical' && modifier < 0) return s;
      modifier = clampModifier(modifier);
      const base = s.priority;
      const adjusted = Math.max(0, Math.round(base * (1 + modifier)));
      if (adjusted === base) return s;
      return { ...s, priority: adjusted, basePriority: base, learningModifier: modifier };
    } catch {
      return s; // fail-safe: malformed decision → unchanged
    }
  });
}
