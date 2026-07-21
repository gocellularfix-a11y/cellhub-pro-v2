// ============================================================
// I6-0 — proactive insight engine (read-only, on-demand).
//
// Runs every registered detector over ONE StructuredQueryContext (the same
// canonical, store-scoped context the I3-2 executor uses) and returns the
// full audited result: emitted insights AND every non-emission with its
// evidence. No persistence, no notifications, no timers, no background
// work — future presenter/Business Manager/alert rounds consume this.
// ============================================================

import type { StructuredQueryContext } from '../query/types';
import type { ProactiveInsightsResult } from './types';
import { resolveAnalysisWindows } from './analysisWindow';
import { runSalesTrendDetector } from './detectors/salesTrendDetector';

/** Detector registry — extend here, one entry per future detector. */
const DETECTORS = [runSalesTrendDetector] as const;

export function runProactiveInsightDetectors(ctx: StructuredQueryContext): ProactiveInsightsResult {
  const windows = resolveAnalysisWindows(ctx.referenceDate);
  const runs = DETECTORS.map((detector) => detector(ctx, windows));
  return {
    referenceYMD: windows.referenceYMD,
    insights: runs.map((r) => r.insight).filter((i): i is NonNullable<typeof i> => i !== null),
    evaluations: runs.map((r) => r.evaluation),
  };
}
