// ============================================================
// R-INTELLIGENCE-F4A: Prepared Actions Today — wiring over F3B output.
//
// Takes the SAME ranked set that produces Top Actions Today (F3B's
// collectDecisions → normalizeAndRank, untouched) and prepares each of the
// top-3 ranked decisions into a PreparedAction. 1:1 with the Top Actions, same
// order, same dedupe. Ranking/scoring/approval are NOT altered — this only adds
// a preparation projection on top.
//
// Impure only in that it reads the engine (via collectDecisions). It does NOT
// stamp a wall-clock timestamp: the output is identity-stable and deterministic
// for a given engine state, so repeated calls produce equal PreparedActions
// (lifecycle timestamps are deferred to F5/F6). Has NO consumer yet — additive,
// recommendation-only, no execution.
// ============================================================

import type { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';
import type { Lang3 } from '@/services/intelligence/chat/handlers';
import { collectDecisions } from '../ranking/getTopActionsToday';
import { normalizeAndRank, MAX_TOP_ACTIONS, type TopActionsOptions } from '../ranking/topActionsRanking';
import { prepareAction } from './prepareAction';
import type { PreparedAction } from './PreparedAction';

/**
 * Prepare the canonical Top 3 Actions Today as PreparedAction[]. Reuses the F3B
 * ranking pipeline verbatim; only the trailing preparation step is new.
 */
export function getPreparedActionsToday(
  engine: IntelligenceEngine,
  lang: Lang3,
  opts: TopActionsOptions = {},
): PreparedAction[] {
  return normalizeAndRank(collectDecisions(engine, lang), opts)
    .slice(0, MAX_TOP_ACTIONS)
    .map((s) => prepareAction(s.decision, { lang, isSecondary: opts.isSecondary }));
}
