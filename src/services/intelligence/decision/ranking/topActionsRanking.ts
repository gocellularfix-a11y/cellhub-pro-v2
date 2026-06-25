// ============================================================
// R-INTELLIGENCE-F3B: Top Actions Today — pure ranking core.
//
// The first real consumer of Track A:
//   IntelligenceDecision → computeApprovalRequirement → scoreDecision
//   → compareScoredDecisions.
//
// Pure + deterministic: given a list of already-normalized IntelligenceDecisions
// (and an explicit cooldown signal), it scores, stably ranks, deduplicates, and
// maps the top 3 to TopAction. NO engine reads, NO Date, NO randomness, NO
// execution. The impure collection of signals from the engine lives in the
// separate getTopActionsToday.ts wrapper.
// ============================================================

import type { IntelligenceDecision, DecisionDomain } from '../IntelligenceDecision';
import type { ApprovalKind } from '../approval/types';
import { computeApprovalRequirement } from '../approval/computeApprovalRequirement';
import { scoreDecision, compareScoredDecisions, type ScoredDecision } from './scoreDecision';
import { applyLearningInfluence } from '../learning/applyLearningInfluence';

export const MAX_TOP_ACTIONS = 3;

export interface TopAction {
  decisionId: string;
  title: string;
  reason: string;
  domain: DecisionDomain;
  confidence: number;
  impactCents?: number;
  approvalRequired: boolean;
  approvalKind: ApprovalKind;
  /** True when impactCents surfaces owner-only margin/cost — the UI redacts it for non-owners. */
  financialSensitive: boolean;
}

export interface TopActionsOptions {
  /**
   * Deterministic, caller-supplied cooldown signal (the impure execution-history
   * read lives in the caller). Default: nothing recently actioned.
   */
  recentlyActioned?: (decision: IntelligenceDecision) => boolean;
  /** Whether the request originates from a secondary terminal (passed to approval). */
  isSecondary?: boolean;
  /**
   * R-INTEL-LEARNING-WIRE: optional per-entity advisory modifiers
   * (Map<entityId, modifier∈[-0.10,+0.10]>) applied to each decision's base
   * priority before sorting. Omit ⇒ ranking is unaffected (fail-safe).
   */
  learningModifiers?: Map<string, number>;
}

/**
 * Dedupe key — collapses repeats so the same customer / inventory item / repair
 * / opportunity never appears twice. Keyed by the concrete entity when present,
 * otherwise by (domain + recommended action).
 */
export function dedupeKey(d: IntelligenceDecision): string {
  if (d.entityRef?.id) return `id:${d.entityRef.id}`;
  return `da:${d.domain}:${d.decision}`;
}

/**
 * Score every decision, stably rank with the canonical comparator, then dedupe
 * keeping the highest-priority survivor per key (the list is already sorted, so
 * first-seen wins). Pure + deterministic.
 */
export function normalizeAndRank(
  decisions: IntelligenceDecision[],
  opts: TopActionsOptions = {},
): ScoredDecision[] {
  const baseScored = decisions.map((d) =>
    scoreDecision(d, { recentlyActioned: opts.recentlyActioned?.(d) ?? false }),
  );
  // R-INTEL-LEARNING-WIRE: bounded advisory adjustment after base scoring,
  // before sorting. No-op when opts.learningModifiers is absent/empty.
  const scored = applyLearningInfluence(baseScored, opts.learningModifiers);
  scored.sort(compareScoredDecisions);

  const seen = new Set<string>();
  const deduped: ScoredDecision[] = [];
  for (const s of scored) {
    const key = dedupeKey(s.decision);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped;
}

/** Map one ranked decision → TopAction, enriching with its approval requirement. */
export function toTopAction(scored: ScoredDecision, opts: TopActionsOptions = {}): TopAction {
  const d = scored.decision;
  const req = computeApprovalRequirement(d, { isSecondary: opts.isSecondary });
  return {
    decisionId: d.id,
    title: d.reasoning,
    reason: d.observation,
    domain: d.domain,
    confidence: d.confidence,
    impactCents: d.impactCents,
    approvalRequired: req.approvalRequired,
    approvalKind: req.approvalKind,
    financialSensitive: d.financialSensitive,
  };
}

/**
 * Pure: rank a set of decisions and return the top 3 as TopAction[]. The single
 * source of ordering is compareScoredDecisions — no secondary ranking, no
 * custom overrides.
 */
export function rankToTopActions(
  decisions: IntelligenceDecision[],
  opts: TopActionsOptions = {},
): TopAction[] {
  return normalizeAndRank(decisions, opts)
    .slice(0, MAX_TOP_ACTIONS)
    .map((s) => toTopAction(s, opts));
}
