// ============================================================
// R-INTELLIGENCE-F7C: LearningInfluence canonical model (ADVISORY ONLY).
//
// F7C turns deterministic LearningInterpretations into ADVISORY influence
// suggestions. It is a leaf node: NOTHING consumes its output yet. It does NOT
// change scoring, does NOT change ranking, does NOT touch F3B / Top Actions
// Today, does NOT create feedback loops, and does NOT persist memory.
//
// Every influence is `advisoryOnly: true` (literal) and carries a BOUNDED,
// CLAMPED modifier — the clamp is the structural guarantee against ranking
// drift. Because F7A/F7B are GLOBAL-only, a global modifier applied uniformly
// could not reorder anything anyway; the bound + advisory flag are the belt and
// suspenders on top of that.
//
// Identity is deterministic (`influence:global:${influenceType}`) and carries
// NO timestamp. Same interpretations → byte-identical influences.
// ============================================================

/**
 * The advisory adjustment an influence represents, 1:1 with the four
 * interpretation patterns:
 *  - COMPLETION_BOOST  ← STRONG_COMPLETION_PATTERN (positive)
 *  - COMPLETION_DROP   ← WEAK_COMPLETION_PATTERN   (negative)
 *  - FAILURE_DAMPEN    ← ELEVATED_FAILURE_PATTERN  (negative)
 *  - IGNORE_DAMPEN     ← ELEVATED_IGNORE_PATTERN   (negative)
 */
export type LearningInfluenceType =
  | 'COMPLETION_BOOST'
  | 'COMPLETION_DROP'
  | 'FAILURE_DAMPEN'
  | 'IGNORE_DAMPEN';

/**
 * The maximum absolute value any influence modifier may take. Modifiers are
 * clamped to [-MAX_ABSOLUTE_LEARNING_MODIFIER, +MAX_ABSOLUTE_LEARNING_MODIFIER].
 * This bound is the hard guard against unbounded ranking drift in any future
 * consumer.
 */
export const MAX_ABSOLUTE_LEARNING_MODIFIER = 0.1;

/** A single deterministic, advisory-only influence derived from one interpretation. */
export interface LearningInfluence {
  /** Deterministic, idempotent: `influence:global:${influenceType}`. */
  id: string;
  /** Which advisory adjustment this represents. */
  influenceType: LearningInfluenceType;
  /** Subject scope (F7C: always 'GLOBAL', mirroring F7A/F7B). */
  subjectType: 'GLOBAL';
  /** Subject id (F7C: always 'global'). */
  subjectId: 'global';
  /** Bounded, clamped advisory modifier in [-0.10, 0.10]. Sign = direction. */
  modifier: number;
  /** Carried through from the source interpretation (no recompute). */
  confidence: number;
  /** Carried through from the source interpretation (no recompute). */
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  /** ALWAYS the literal true in F7C — compile-time advisory guarantee. */
  advisoryOnly: true;
  /** Ids of the interpretation(s) this influence came from (F7C: exactly one). */
  sourceInterpretationIds: string[];
  /**
   * Hardcoded, deterministic template text. No AI generation.
   * NOTE: English-only for now. When this surfaces to UI in a future phase it
   * must be made bilingual EN/ES/PT (project rule). Today F7C has no UI consumer.
   */
  rationale: string;
}
