// R-INTELLIGENCE-FEEDBACK-LOOP-V1
// Deterministic score computation from feedback events.
// No randomness, no AI. Pure math over operator signals.

import type { IntelligenceFeedbackEvent, IntelligenceFeedbackType } from './types';
import type { ManagerQueueItem } from '../managerQueue/types';

// Operator action weights — adjusted by operational impact.
// Positive: operator found value and acted.
// Negative: operator found noise or deferred.
export const FEEDBACK_WEIGHTS: Record<IntelligenceFeedbackType, number> = {
  useful:     +3,
  resolved:   +2,
  snoozed:    -2,
  ignored:    -1,
  not_useful: -3,
};

const SCORE_MIN = -10;
const SCORE_MAX = +10;

// Build Map<fingerprint, clampedScore> in O(n) — one pass over all events.
// Pass this into getPendingItems() for ranking. Rebuild whenever feedback changes.
export function buildScoreMap(events: IntelligenceFeedbackEvent[]): Map<string, number> {
  const raw = new Map<string, number>();
  for (const e of events) {
    if (!e.fingerprint) continue;
    raw.set(e.fingerprint, (raw.get(e.fingerprint) ?? 0) + FEEDBACK_WEIGHTS[e.type]);
  }
  const clamped = new Map<string, number>();
  for (const [fp, score] of raw) {
    clamped.set(fp, Math.max(SCORE_MIN, Math.min(SCORE_MAX, score)));
  }
  return clamped;
}

// Score for a single fingerprint from a pre-built map — O(1).
export function getFingerprintScore(
  fingerprint: string | undefined,
  scoreMap: Map<string, number>,
): number {
  if (!fingerprint) return 0;
  return scoreMap.get(fingerprint) ?? 0;
}

// Convenience wrapper for a queue item.
export function getItemScore(item: ManagerQueueItem, scoreMap: Map<string, number>): number {
  return getFingerprintScore(item.fingerprint, scoreMap);
}
