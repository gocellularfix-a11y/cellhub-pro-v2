// ============================================================
// R-INTELLIGENCE-F7C: deterministic advisory Learning Influence builder.
//
// LearningInterpretation[] → LearningInfluence[]. Pure + deterministic: same
// interpretations → byte-identical influences. NO mutation, NO Date.now(), NO
// randomness, NO side effects, NO scoring, NO ranking, NO persistence, NO
// feedback loops.
//
// One influence per interpretation, in input order (no merging). Every modifier
// is clamped to [-MAX, +MAX]; every influence is advisoryOnly. This file must
// NOT import scoring / ranking / Top Actions modules — F7C is a leaf node.
// ============================================================

import type {
  LearningInterpretation,
  LearningInterpretationType,
  LearningInterpretationSeverity,
} from './LearningInterpretation';
import {
  type LearningInfluence,
  type LearningInfluenceType,
  MAX_ABSOLUTE_LEARNING_MODIFIER,
} from './LearningInfluence';

/** Interpretation type → influence type (1:1, exhaustive over the four patterns). */
const TYPE_MAP: Record<LearningInterpretationType, LearningInfluenceType> = {
  STRONG_COMPLETION_PATTERN: 'COMPLETION_BOOST',
  WEAK_COMPLETION_PATTERN: 'COMPLETION_DROP',
  ELEVATED_FAILURE_PATTERN: 'FAILURE_DAMPEN',
  ELEVATED_IGNORE_PATTERN: 'IGNORE_DAMPEN',
};

/** Deterministic magnitude per severity band. */
const SEVERITY_MAGNITUDE: Record<LearningInterpretationSeverity, number> = {
  HIGH: 0.1,
  MEDIUM: 0.05,
  LOW: 0.02,
};

/**
 * COMPLETION_BOOST is the only positive direction; every other influence
 * dampens. (+1 / -1 sign applied to the severity magnitude.)
 */
const DIRECTION: Record<LearningInfluenceType, 1 | -1> = {
  COMPLETION_BOOST: 1,
  COMPLETION_DROP: -1,
  FAILURE_DAMPEN: -1,
  IGNORE_DAMPEN: -1,
};

/** Hardcoded deterministic rationale per influence type. English-only (see model note). */
const RATIONALE_MAP: Record<LearningInfluenceType, string> = {
  COMPLETION_BOOST:
    'Strong historical completion suggests a small advisory boost.',
  COMPLETION_DROP:
    'Weak historical completion suggests a small advisory reduction.',
  FAILURE_DAMPEN:
    'Elevated historical failure suggests a small advisory reduction.',
  IGNORE_DAMPEN:
    'Elevated historical ignore rate suggests a small advisory reduction.',
};

/** Clamp a value into [-MAX, +MAX]. The hard guard against ranking drift. */
function clampModifier(value: number): number {
  const max = MAX_ABSOLUTE_LEARNING_MODIFIER;
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

/**
 * Pure: LearningInterpretation[] → LearningInfluence[]. Empty input → []. Emits
 * one advisory influence per interpretation, in input order (no merging, no
 * scoring, no ranking).
 */
export function buildLearningInfluences(
  interpretations: LearningInterpretation[],
): LearningInfluence[] {
  return interpretations.map((interp) => {
    const influenceType = TYPE_MAP[interp.interpretationType];
    const magnitude = SEVERITY_MAGNITUDE[interp.severity];
    const modifier = clampModifier(DIRECTION[influenceType] * magnitude);
    return {
      id: `influence:global:${influenceType}`,
      influenceType,
      subjectType: 'GLOBAL',
      subjectId: 'global',
      modifier,
      confidence: interp.confidence,
      severity: interp.severity,
      advisoryOnly: true,
      sourceInterpretationIds: [interp.id],
      rationale: RATIONALE_MAP[influenceType],
    };
  });
}
