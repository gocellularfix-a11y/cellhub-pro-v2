// ============================================================
// R-INTELLIGENCE-F5C: Operational Queue Summary Today — wiring.
//
// Thin convenience wrapper: projects today's Operational Queue (F5A) and
// summarizes it (F5C). Does NOT alter queue generation — it only reads. No
// execution, no approvals, no messaging, no persistence, no Date.now() of its
// own. Has NO consumer yet — additive, read-only.
// ============================================================

import type { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';
import type { Lang3 } from '@/services/intelligence/chat/handlers';
import type { TopActionsOptions } from '../ranking/topActionsRanking';
import { getExecutionQueueToday } from './getExecutionQueueToday';
import { summarizeOperationalQueue, type OperationalQueueSummary } from './summarizeOperationalQueue';

/** Summarize today's Operational Queue. Reuses F5A queue generation verbatim. */
export function getOperationalQueueSummaryToday(
  engine: IntelligenceEngine,
  lang: Lang3,
  opts: TopActionsOptions = {},
): OperationalQueueSummary {
  return summarizeOperationalQueue(getExecutionQueueToday(engine, lang, opts));
}
