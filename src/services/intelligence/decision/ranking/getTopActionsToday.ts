// ============================================================
// R-INTELLIGENCE-F3B: Top Actions Today — engine collection wrapper.
//
// Collects every existing signal source (no new signal systems), normalizes
// each through Track A (normalizeDecisions), and ranks via the pure core
// (rankToTopActions). The ranking math is deterministic; only the collection is
// data/time-dependent (the generators read "today" from the engine).
//
// Has NO consumer yet — additive, recommendation-only, no execution.
// ============================================================

import type { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';
import type { Lang3 } from '@/services/intelligence/chat/handlers';
import { computeLossSignals } from '@/services/intelligence/chat/whatIsLosingMoney';
import { computeDropSignals } from '@/services/intelligence/chat/whyDidSalesDrop';
import { computeAttentionItemsForToday } from '@/services/intelligence/chat/whoNeedsAttentionToday';
import { computeRestockRecommendations } from '@/services/intelligence/chat/restockOpportunity';
import { computeTodaySlowCauses } from '@/services/intelligence/chat/whyIsTodaySlow';
import type { IntelligenceDecision } from '../IntelligenceDecision';
import { normalizeDecisions } from '../normalizeDecision';
import { rankToTopActions, type TopAction, type TopActionsOptions } from './topActionsRanking';
import { getFeedbackEvents } from '@/services/intelligence/feedback/store';
import { buildScoreMap } from '@/services/intelligence/feedback/scoring';
import { buildEntityLearningModifiers } from '../learning/applyLearningInfluence';

/**
 * Collect all six sources and normalize them to IntelligenceDecision[].
 * Impure (reads the engine). Proactive actions come from the engine's memoized
 * report — no ProactiveEvalContext is rebuilt here.
 */
export function collectDecisions(engine: IntelligenceEngine, lang: Lang3): IntelligenceDecision[] {
  return [
    ...normalizeDecisions({ kind: 'loss', signals: computeLossSignals(engine, lang) }),
    ...normalizeDecisions({ kind: 'drop', signals: computeDropSignals(engine, lang) }),
    ...normalizeDecisions({ kind: 'attention', signals: computeAttentionItemsForToday(engine, lang) }),
    ...normalizeDecisions({ kind: 'restock', signals: computeRestockRecommendations(engine, lang) }),
    ...normalizeDecisions({ kind: 'diagnosis', signals: computeTodaySlowCauses(engine, lang) }),
    ...normalizeDecisions({ kind: 'proactive', signals: engine.getProactiveReport().actions }),
  ];
}

/**
 * R-INTEL-LEARNING-WIRE: build the per-entity advisory learning modifiers from
 * the already-wired operator feedback log (which also receives outcome-driven
 * feedback). Impure (reads localStorage) — kept here in the wrapper, never in the
 * pure ranking core. Fail-safe: any read error yields no modifiers, so ranking is
 * unaffected.
 */
function buildLearningModifiers(): Map<string, number> {
  try {
    return buildEntityLearningModifiers(buildScoreMap(getFeedbackEvents()));
  } catch {
    return new Map();
  }
}

/** Canonical Top 3 Actions Today. */
export function getTopActionsToday(
  engine: IntelligenceEngine,
  lang: Lang3,
  opts: TopActionsOptions = {},
): TopAction[] {
  // Caller-supplied modifiers win; otherwise derive them from feedback history.
  const learningModifiers = opts.learningModifiers ?? buildLearningModifiers();
  return rankToTopActions(collectDecisions(engine, lang), { ...opts, learningModifiers });
}
