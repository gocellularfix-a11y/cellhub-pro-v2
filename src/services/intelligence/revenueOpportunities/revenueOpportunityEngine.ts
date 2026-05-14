// CellHub Intelligence — Revenue Opportunity Engine
// Facade: runs all detectors, sorts by priority, caps at 10.
// Pure function — safe inside useMemo.

import type { RevenueOpportunity, RevenueOpportunityContext } from './revenueOpportunityTypes';
import {
  detectUnpaidBalances,
  detectAbandonedWorkflows,
  detectDelayedRepairs,
  detectInactiveCustomers,
  detectVipRetention,
  detectDeadStock,
  detectLowStock,
  detectMissedAccessoryAttach,
} from './revenueOpportunitySignals';

const MAX_OPPORTUNITIES = 10;

/**
 * Compute all revenue opportunities for the current store state.
 * Each detector runs independently — a failure in one never blocks others.
 * Returns up to MAX_OPPORTUNITIES sorted by priority descending.
 */
export function computeRevenueOpportunities(
  ctx: RevenueOpportunityContext,
): RevenueOpportunity[] {
  const all: RevenueOpportunity[] = [];

  function tryDetect(fn: () => RevenueOpportunity[]): void {
    try {
      const results = fn();
      all.push(...results);
    } catch { /* detector failure — non-fatal */ }
  }

  // Revenue-critical (high confidence, known amounts)
  tryDetect(() => detectUnpaidBalances(ctx.repairs, ctx.layaways));
  tryDetect(() => detectAbandonedWorkflows(ctx.pendingWorkflows));

  // Operational follow-up (medium confidence)
  tryDetect(() => detectDelayedRepairs(ctx.repairs));
  tryDetect(() => detectVipRetention(ctx.customers, ctx.sales));
  tryDetect(() => detectInactiveCustomers(ctx.customers, ctx.sales));

  // Inventory signals (low confidence)
  tryDetect(() => detectDeadStock(ctx.inventory));
  tryDetect(() => detectLowStock(ctx.inventory));

  // Upsell signals (low confidence)
  tryDetect(() => detectMissedAccessoryAttach(ctx.sales));

  return all
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_OPPORTUNITIES);
}
