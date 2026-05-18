// R-GPO-V1 — Priority scoring.
// Global cross-module deterministic scoring. No ML, no randomness.
// Lower score = less important. Higher score = more important.

import type { AggregatedPriority, OperationalPriorityCategory } from './types';

const SEVERITY_BASE: Record<string, number> = {
  critical: 90,
  high:     60,
  medium:   30,
};

// Category tiebreak bonus — pickup and payment come first by default.
const CATEGORY_BONUS: Record<OperationalPriorityCategory, number> = {
  pickup_opportunity: 8,
  payment_collection: 6,
  customer_outreach:  4,
  business_risk:      3,
  inventory_attention: 2,
  system_attention:   0,
};

export function scorePriority(priority: AggregatedPriority): number {
  const base          = SEVERITY_BASE[priority.severity] ?? 30;
  const signalBoost   = Math.min((priority.signalCount - 1) * 5, 25);
  const actionBoost   = priority.actionable ? 10 : 0;
  const categoryBonus = CATEGORY_BONUS[priority.category] ?? 0;
  return base + signalBoost + actionBoost + categoryBonus;
}

export function sortPriorities(
  priorities: AggregatedPriority[],
): AggregatedPriority[] {
  return priorities.slice().sort((a, b) => b.score - a.score);
}
