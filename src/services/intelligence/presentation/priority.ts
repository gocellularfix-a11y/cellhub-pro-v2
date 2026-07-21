// ============================================================
// I6-C1 — InsightPriorityEngine.
//
// Deterministic, total ordering shared by EVERY consumer. No consumer sorts
// insights on its own. Ordering axes, in strict precedence:
//   1. priority tier         (business urgency: critical → info)
//   2. evidence confidence    (better-supported findings first, desc)
//   3. detector priority      (registry order — stable, extensible)
//   4. fingerprint            (final total-order tiebreak — never random)
//
// Freshness note: the proactive layer runs ONE reference window per run
// (7/30 full days ending yesterday), so every insight shares the same
// recency — freshness is uniform here and therefore not a differentiating
// axis. It is documented as an axis so a future multi-window layer can slot
// it in above (3) without reordering the others.
// ============================================================

import type { InsightCard, InsightPriority } from './types';
import type { ProactiveDetectorId, ProactiveInsightDirection, ProactiveInsightSeverity } from '../proactiveInsights/types';

/** (severity, direction) → the ONE visual priority tier. Positive movement
 *  (severity 'watch' by detector rule) is split out so good news ranks below
 *  watch-risk of the same severity, yet still above data-quality info. */
export function priorityOf(severity: ProactiveInsightSeverity, direction: ProactiveInsightDirection): InsightPriority {
  if (severity === 'critical') return 'critical';
  if (severity === 'important') return 'important';
  if (severity === 'info') return 'info';
  // severity === 'watch'
  return direction === 'positive' ? 'positive' : 'watch';
}

const PRIORITY_RANK: Record<InsightPriority, number> = {
  critical: 0, important: 1, watch: 2, positive: 3, info: 4,
};

/** Registry execution order — the detector priority tiebreak. Mirrors
 *  PROACTIVE_DETECTORS; unknown ids sort last (defensive, never throws). */
const DETECTOR_RANK: Record<ProactiveDetectorId, number> = {
  sales_momentum: 0,
  gross_margin_pressure: 1,
  carrier_concentration: 2,
  evidence_quality: 3,
};

export function priorityRank(priority: InsightPriority): number {
  return PRIORITY_RANK[priority];
}

/** Total-order comparator for cards. Deterministic and stable. */
export function compareCards(a: InsightCard, b: InsightCard): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || b.confidence - a.confidence
    || (DETECTOR_RANK[a.detectorId] ?? 99) - (DETECTOR_RANK[b.detectorId] ?? 99)
    || a.fingerprint.localeCompare(b.fingerprint)
  );
}

/** Order a card list without mutating the input. */
export function orderCards(cards: InsightCard[]): InsightCard[] {
  return [...cards].sort(compareCards);
}
