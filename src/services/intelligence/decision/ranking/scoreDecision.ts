// ============================================================
// R-INTELLIGENCE-F3A: deterministic decision-scoring engine.
//
// Pure + deterministic. Given an IntelligenceDecision (and an explicit,
// caller-supplied cooldown signal), produce a cross-source-comparable priority
// score plus the components needed for stable tie-breaking. NO AI, NO
// randomness, NO timestamps read here (the impure execution-history read that
// decides `recentlyActioned` lives in the future F3B caller, keeping F3A pure).
//
// This file does NOT assemble Top-3, touch the Dashboard/Daily Brief, or
// consume any decision — it is scoring math + ordering helpers only.
// ============================================================

import type { IntelligenceDecision, DecisionUrgency, DecisionDomain } from '../IntelligenceDecision';

// ── Tunable weights (sum to 1) ────────────────────────────
export const W_VALUE = 0.45;
export const W_URGENCY = 0.30;
export const W_CONFIDENCE = 0.25;

/** Flat demotion applied when the decision's entity was acted on recently. */
export const COOLDOWN_PENALTY = 40;

// ── Component scorers (all return 0..100, pure) ───────────

/**
 * Map dollar impact (cents) to a 0..100 band. Banded (not linear) so a single
 * huge leak doesn't dwarf everything else. Undefined/≤0 → 0.
 *   ≥ $500 → 100 · ≥ $200 → 70 · ≥ $50 → 40 · > $0 → 20 · else → 0
 */
export function valueScore(impactCents: number | undefined): number {
  if (impactCents === undefined || !Number.isFinite(impactCents) || impactCents <= 0) return 0;
  if (impactCents >= 50_000) return 100;
  if (impactCents >= 20_000) return 70;
  if (impactCents >= 5_000) return 40;
  return 20;
}

const URGENCY_SCORE: Record<DecisionUrgency, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
};

/** Map an urgency band to a 0..100 score. */
export function urgencyScore(urgency: DecisionUrgency): number {
  return URGENCY_SCORE[urgency];
}

/** Flat penalty when the decision was recently acted on (caller-supplied flag). */
export function cooldownPenalty(recentlyActioned: boolean | undefined): number {
  return recentlyActioned === true ? COOLDOWN_PENALTY : 0;
}

// ── Score context (explicit, deterministic inputs only) ───
export interface ScoreContext {
  /**
   * True when this decision's entity was acted on recently. The caller (F3B)
   * computes this from execution history; passing it in keeps scoring pure.
   */
  recentlyActioned?: boolean;
}

export interface ScoredDecision {
  decision: IntelligenceDecision;
  /** 0..100 (clamped); cooldown can demote toward 0. Rounded integer. */
  priority: number;
  // Components kept for transparency + tie-breaking.
  valueScore: number;
  urgencyScore: number;
  confidence: number;
  cooldownPenalty: number;
}

/**
 * Score one decision. Deterministic: same (decision, ctx) → same ScoredDecision.
 *   priority = W_VALUE·value + W_URGENCY·urgency + W_CONFIDENCE·confidence − cooldown
 */
export function scoreDecision(decision: IntelligenceDecision, ctx: ScoreContext = {}): ScoredDecision {
  const v = valueScore(decision.impactCents);
  const u = urgencyScore(decision.urgency);
  const c = Number.isFinite(decision.confidence) ? Math.max(0, Math.min(100, decision.confidence)) : 0;
  const penalty = cooldownPenalty(ctx.recentlyActioned);

  const raw = W_VALUE * v + W_URGENCY * u + W_CONFIDENCE * c - penalty;
  const priority = Math.max(0, Math.round(raw));

  return {
    decision,
    priority,
    valueScore: v,
    urgencyScore: u,
    confidence: c,
    cooldownPenalty: penalty,
  };
}

// ── Stable ordering support (tie-break comparator) ────────
// Fixed domain precedence — lower index ranks higher. Money-first.
export const DOMAIN_ORDER: Record<DecisionDomain, number> = {
  cash: 0,
  repair: 1,
  inventory: 2,
  customer: 3,
  marketing: 4,
  ops: 5,
  tax: 6,
};

/**
 * Total-order comparator for ScoredDecision (use with Array.sort; highest
 * priority first). Deterministic and STABLE — every tie is resolved, ending in
 * a lexicographic decision.id tiebreak, so the sort is never ambiguous:
 *   1. priority desc → 2. urgency desc → 3. impactCents desc → 4. confidence desc
 *   → 5. domain fixed-order asc → 6. decision.id lexicographic asc
 */
export function compareScoredDecisions(a: ScoredDecision, b: ScoredDecision): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
  const ai = a.decision.impactCents ?? 0;
  const bi = b.decision.impactCents ?? 0;
  if (bi !== ai) return bi - ai;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const ad = DOMAIN_ORDER[a.decision.domain];
  const bd = DOMAIN_ORDER[b.decision.domain];
  if (ad !== bd) return ad - bd;
  if (a.decision.id < b.decision.id) return -1;
  if (a.decision.id > b.decision.id) return 1;
  return 0;
}
