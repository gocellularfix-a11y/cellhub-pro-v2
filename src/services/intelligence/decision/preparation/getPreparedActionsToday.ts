// ============================================================
// R-INTELLIGENCE-F4A: Prepared Actions Today — wiring over F3B output.
//
// Takes the SAME ranked set that produces Top Actions Today (F3B's
// collectDecisions → normalizeAndRank, untouched) and prepares each of the
// top-3 ranked decisions into a PreparedAction. 1:1 with the Top Actions, same
// order, same dedupe. Ranking/scoring/approval are NOT altered — this only adds
// a preparation projection on top.
//
// Impure boundary: reads the engine (via collectDecisions) and stamps
// `createdAt` from the clock. The actual preparation math (prepareAction) stays
// pure. Has NO consumer yet — additive, recommendation-only, no execution.
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
  const now = Date.now();
  return normalizeAndRank(collectDecisions(engine, lang), opts)
    .slice(0, MAX_TOP_ACTIONS)
    .map((s) => prepareAction(s.decision, { lang, now, isSecondary: opts.isSecondary }));
}
