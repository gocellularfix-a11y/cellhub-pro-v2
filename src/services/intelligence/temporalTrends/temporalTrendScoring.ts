// CellHub Intelligence — Temporal Trend Scoring
// Deterministic 0–100 momentum score from two time-window counts.
// 50 = stable, >60 = improving, <40 = declining.

import type { TrendDirection } from './temporalTrendTypes';

/**
 * Compute a 0–100 momentum score from two window counts.
 * Designed so 50 = stable (1:1 ratio), 80 = strong improvement, 20 = sharp decline.
 */
export function computeMomentumScore(recentCount: number, prevCount: number): number {
  if (recentCount === 0 && prevCount === 0) return 50; // no data — stable
  if (prevCount === 0) return recentCount > 0 ? 80 : 50; // new activity
  if (recentCount === 0) return 20; // complete drop-off
  const ratio = recentCount / prevCount;
  if (ratio >= 2.0)  return 95; // accelerating — doubled or more
  if (ratio >= 1.5)  return 80; // strong improvement
  if (ratio >= 1.15) return 65; // slight improvement
  if (ratio >= 0.85) return 50; // stable
  if (ratio >= 0.5)  return 35; // notable decline
  if (ratio >= 0.25) return 20; // significant decline
  return 10;                    // sharp collapse
}

/** Map a 0–100 momentum score to a direction. */
export function momentumDirection(score: number): TrendDirection {
  if (score >= 65) return 'up';
  if (score <= 35) return 'down';
  return 'flat';
}

/** Minimum confidence level given data density in both windows. */
export function momentumConfidence(
  recentCount: number,
  prevCount: number,
): 'high' | 'medium' | 'low' {
  const total = recentCount + prevCount;
  if (total >= 4) return 'high';
  if (total >= 2) return 'medium';
  return 'low';
}
