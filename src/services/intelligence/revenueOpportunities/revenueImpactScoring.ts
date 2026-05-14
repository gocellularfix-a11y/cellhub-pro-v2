// CellHub Intelligence — Revenue Impact Scoring
// Deterministic 0–100 priority score for revenue opportunities.
// Weights: impact (40) + urgency (25) + confidence (20) + actionability (15).

import type { RevenueConfidence } from './revenueOpportunityTypes';

/**
 * Compute a 0–100 priority score for a revenue opportunity.
 *
 * @param estimatedImpactCents  Known recoverable amount (0 = unknown).
 * @param confidence            Strength of the signal.
 * @param urgency               0–10 intrinsic urgency (set by detector from issue age).
 * @param hasActions            Whether at least one executable action is available.
 */
export function computeRevenuePriorityScore(
  estimatedImpactCents: number,
  confidence: RevenueConfidence,
  urgency: number,
  hasActions: boolean,
): number {
  // Impact — logarithmic scale: $0→0, $10→14, $100→28, $500→35, $1000+→40
  const impactScore = estimatedImpactCents > 0
    ? Math.min(40, Math.round(Math.log10(estimatedImpactCents + 1) * 14))
    : 0;

  // Urgency — linear: 0/10=0, 5/10=12.5, 10/10=25
  const urgencyScore = Math.round(Math.min(10, Math.max(0, urgency)) * 2.5);

  // Confidence — fixed tiers
  const confidenceScore = confidence === 'high' ? 20 : confidence === 'medium' ? 12 : 5;

  // Actionability — has an executable path vs informational-only
  const actionabilityScore = hasActions ? 15 : 5;

  return Math.min(100, impactScore + urgencyScore + confidenceScore + actionabilityScore);
}
