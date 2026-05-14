// CellHub Intelligence — Revenue Opportunity Selectors
// Pure read-only helpers that filter/slice the pre-computed opportunity list.

import type { RevenueOpportunity, RevenueOpportunityType } from './revenueOpportunityTypes';

/** All opportunities sorted by priority descending (input already sorted). */
export function getRevenueOpportunities(
  opportunities: RevenueOpportunity[],
): RevenueOpportunity[] {
  return opportunities;
}

/** Single highest-priority opportunity, or null when none exist. */
export function getTopRevenueOpportunity(
  opportunities: RevenueOpportunity[],
): RevenueOpportunity | null {
  return opportunities[0] ?? null;
}

/** Opportunities that represent uncollected money (balance recovery, workflow). */
export function getRevenueLeaks(
  opportunities: RevenueOpportunity[],
): RevenueOpportunity[] {
  const LEAK_TYPES = new Set<RevenueOpportunityType>([
    'unpaid_balance_recovery',
    'delayed_repair_recovery',
    'abandoned_workflow_recovery',
  ]);
  return opportunities.filter((o) => LEAK_TYPES.has(o.type));
}

/** Opportunities tied to a specific customer. */
export function getCustomerRevenueOpportunities(
  opportunities: RevenueOpportunity[],
  customerId?: string | null,
): RevenueOpportunity[] {
  if (!customerId) {
    return opportunities.filter((o) => !!o.relatedCustomerId);
  }
  return opportunities.filter((o) => o.relatedCustomerId === customerId);
}

/** Opportunities in the inventory domain (dead stock, low stock). */
export function getInventoryRevenueOpportunities(
  opportunities: RevenueOpportunity[],
): RevenueOpportunity[] {
  const INVENTORY_TYPES = new Set<RevenueOpportunityType>([
    'dead_stock_push',
    'low_stock_reorder',
  ]);
  return opportunities.filter((o) => INVENTORY_TYPES.has(o.type));
}

/** Opportunities arising from incomplete or abandoned workflows. */
export function getWorkflowRevenueOpportunities(
  opportunities: RevenueOpportunity[],
): RevenueOpportunity[] {
  return opportunities.filter((o) => o.type === 'abandoned_workflow_recovery');
}
