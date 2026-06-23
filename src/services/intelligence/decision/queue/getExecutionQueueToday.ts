// ============================================================
// R-INTELLIGENCE-F5A: Execution Queue Today — projection over F4A output.
//
// Projects the canonical Prepared Actions Today (F4A) into QueueItem[]. It is a
// PROJECTION only — NOT a worker, NOT a scheduler, NOT an executor. No
// persistence, no writes, no execution, no Date.now(): the output is identity-
// stable and deterministic for a given engine state, so repeated calls produce
// equal QueueItems.
//
// Has NO consumer yet — additive, recommendation-only.
// ============================================================

import type { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';
import type { Lang3 } from '@/services/intelligence/chat/handlers';
import type { TopActionsOptions } from '../ranking/topActionsRanking';
import { getPreparedActionsToday } from '../preparation/getPreparedActionsToday';
import { buildQueueItem } from './buildQueueItem';
import type { QueueItem } from './QueueItem';

/**
 * Project the canonical Prepared Actions Today as a QueueItem[]. Reuses the F4A
 * preparation pipeline verbatim; only the trailing queue projection is new.
 */
export function getExecutionQueueToday(
  engine: IntelligenceEngine,
  lang: Lang3,
  opts: TopActionsOptions = {},
): QueueItem[] {
  return getPreparedActionsToday(engine, lang, opts).map((p) => buildQueueItem(p));
}
