import type { IntelligenceOutcome, OutcomeStats } from './outcomeTypes';

// Maps chain source IDs → their corresponding strategy suggestion IDs.
// Used to suppress/dampen strategy suggestions when chains complete or are repeatedly skipped.
const CHAIN_TO_SUGGESTION: Record<string, string> = {
  collection_recovery:    'strategy_collection_focus',
  repair_cleanup:         'strategy_repair_cleanup_focus',
  vip_customer_recovery:  'strategy_customer_retention_focus',
  workflow_stabilization: 'strategy_workflow_stabilization_focus',
  upsell_momentum:        'strategy_upsell_focus',
};

/**
 * Aggregate IntelligenceOutcome records into an OutcomeStats snapshot.
 * Pure function — safe inside useMemo.
 */
export function computeOutcomeStats(outcomes: IntelligenceOutcome[]): OutcomeStats {
  const now = Date.now();
  const oneDayAgo   = now - 24 * 60 * 60 * 1000;
  const twoHoursAgo = now - 2  * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let completedCount = 0, skippedCount = 0, dismissedCount = 0, recoveredCount = 0, unresolvedCount = 0;
  let recoveredImpactCents = 0;

  const completedBySource  = new Map<string, number>();
  const skippedBySource24h = new Map<string, number>();
  const recentChainCompletions: string[] = [];

  for (const o of outcomes) {
    switch (o.outcome) {
      case 'completed':  completedCount++;  break;
      case 'skipped':    skippedCount++;    break;
      case 'dismissed':  dismissedCount++;  break;
      case 'recovered':  recoveredCount++;  recoveredImpactCents += o.estimatedImpactCents ?? 0; break;
      case 'unresolved': unresolvedCount++; break;
    }

    if ((o.outcome === 'completed' || o.outcome === 'recovered') && o.createdAt > sevenDaysAgo) {
      completedBySource.set(o.sourceId, (completedBySource.get(o.sourceId) ?? 0) + 1);
    }

    if ((o.outcome === 'skipped' || o.outcome === 'dismissed') && o.createdAt > oneDayAgo) {
      skippedBySource24h.set(o.sourceId, (skippedBySource24h.get(o.sourceId) ?? 0) + 1);
    }

    // Whole-chain completions (no stepId tag) within the 2h window.
    if (
      o.sourceType === 'chain' &&
      o.outcome === 'completed' &&
      o.metadata?.type === 'chain' &&
      (o.completedAt ?? 0) > twoHoursAgo
    ) {
      recentChainCompletions.push(o.sourceId);
    }
  }

  const total = completedCount + skippedCount + dismissedCount + recoveredCount + unresolvedCount;

  const topCompletedSourceIds = [...completedBySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  // Sources skipped/dismissed ≥3× in 24h → dampen their strategy suggestion priority.
  const recentlyIgnoredSourceIds: string[] = [];
  for (const [sourceId, count] of skippedBySource24h.entries()) {
    if (count >= 3) {
      const suggId = CHAIN_TO_SUGGESTION[sourceId];
      if (suggId) recentlyIgnoredSourceIds.push(suggId);
    }
  }

  // Recently completed chains → suppress their strategy suggestions for 2h cooldown.
  const recentlyCompletedSourceIds = [
    ...new Set(recentChainCompletions.map((t) => CHAIN_TO_SUGGESTION[t]).filter(Boolean)),
  ];

  return {
    completedCount,
    skippedCount,
    dismissedCount,
    recoveredCount,
    unresolvedCount,
    completionRate: total > 0 ? (completedCount + recoveredCount) / total : 0,
    recoveredImpactCents,
    topCompletedSourceIds,
    recentlyIgnoredSourceIds,
    recentlyCompletedSourceIds,
  };
}
