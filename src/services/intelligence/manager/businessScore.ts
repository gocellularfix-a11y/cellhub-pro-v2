// ============================================================
// Business Manager — business score (I4 Part 4).
//
// 0-100, computed ONLY from findings with fixed exported weights. Fully
// reproducible: identical findings → identical score, and the breakdown
// carries every applied delta.
// ============================================================

import type { InsightFinding, TrendDirection } from '../insights/types';
import type { BusinessScore } from './types';

// Exported deterministic weights (tests pin these).
export const SCORE_BASE = 100;
export const SCORE_WEIGHTS = {
  critical: -25,
  warning: -8,
  opportunity: +1,
  positive: +2,
  trendUp: +5,
  trendDown: -5,
} as const;
export const SCORE_POSITIVE_CAP = 10;   // positives/opportunities can add at most +10 combined

// I4.1 — evidence confidence (STRICTLY separate from performance):
// unavailable sections and empty evidence lower CONFIDENCE, never the score.
export const CONFIDENCE_PENALTY_PER_UNAVAILABLE = 0.1;
export const MIN_CONFIDENCE = 0.2;
export const NO_FINDINGS_CONFIDENCE = 0.2;

/** @param unavailableSections count of health sections that could not be
 *  evaluated — a CONFIDENCE input only; it never moves the score. */
export function computeBusinessScore(findings: InsightFinding[], unavailableSections = 0): BusinessScore {
  let criticalCount = 0; let warningCount = 0; let opportunityCount = 0; let positiveCount = 0;
  for (const f of findings) {
    if (f.severity === 'critical') criticalCount++;
    else if (f.severity === 'warning') warningCount++;
    else if (f.severity === 'opportunity') opportunityCount++;
    else if (f.severity === 'positive') positiveCount++;
  }

  // Headline trend: the gross_sales metric_trend finding (I3-3 emits it).
  const salesTrend = findings.find((f) => f.kind === 'metric_trend' && f.data.metric === 'gross_sales');
  const trendDirection = (salesTrend?.data.direction as TrendDirection | undefined) ?? null;

  const positiveDelta = Math.min(
    SCORE_POSITIVE_CAP,
    opportunityCount * SCORE_WEIGHTS.opportunity + positiveCount * SCORE_WEIGHTS.positive,
  );
  const appliedDelta =
    criticalCount * SCORE_WEIGHTS.critical
    + warningCount * SCORE_WEIGHTS.warning
    + positiveDelta
    + (trendDirection === 'up' ? SCORE_WEIGHTS.trendUp : trendDirection === 'down' ? SCORE_WEIGHTS.trendDown : 0);

  const score = Math.max(0, Math.min(100, SCORE_BASE + appliedDelta));

  // Evidence confidence: no findings at all → floor; otherwise 1 minus a
  // fixed penalty per unavailable section, floored. Deterministic.
  const confidence = findings.length === 0
    ? NO_FINDINGS_CONFIDENCE
    : Math.max(MIN_CONFIDENCE, Math.round((1 - unavailableSections * CONFIDENCE_PENALTY_PER_UNAVAILABLE) * 100) / 100);

  return {
    score,
    confidence,
    breakdown: { criticalCount, warningCount, opportunityCount, positiveCount, trendDirection, appliedDelta, unavailableSections },
  };
}
