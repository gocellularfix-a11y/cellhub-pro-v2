import { getRecentOutcomes } from './outcomeStore';
import { computeOutcomeStats } from './outcomeEngine';
import type { OutcomeStats } from './outcomeTypes';

/** Load recent outcomes and compute aggregated stats. Reads localStorage — call inside useMemo. */
export function getOutcomeStats(): OutcomeStats {
  return computeOutcomeStats(getRecentOutcomes());
}

/**
 * Return the set of chain type IDs whose whole-chain completion was recorded within windowMs.
 * Used in the bubble to suppress recently completed chains from re-surfacing immediately.
 */
export function getRecentlyCompletedChainTypes(windowMs = 2 * 60 * 60 * 1000): Set<string> {
  const cutoff = Date.now() - windowMs;
  return new Set(
    getRecentOutcomes()
      .filter(
        (o) =>
          o.sourceType === 'chain' &&
          o.outcome === 'completed' &&
          o.metadata?.type === 'chain' &&
          (o.completedAt ?? 0) > cutoff,
      )
      .map((o) => o.sourceId),
  );
}
