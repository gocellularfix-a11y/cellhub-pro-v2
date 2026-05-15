// R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1
// Aggregates all module detectors into a single prioritized opportunity list.

import type { ModuleOpportunity, ModuleWideContext } from './moduleWideOpportunityTypes';
import {
  detectRepairOpportunities,
  detectInventoryOpportunities,
  detectCustomerOpportunities,
  detectLayawayOpportunities,
  detectDiscountOpportunities,
} from './moduleWideOpportunityDetectors';

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function computeModuleWideOpportunities(ctx: ModuleWideContext): ModuleOpportunity[] {
  const all: ModuleOpportunity[] = [];
  const now = Date.now();

  const run = (fn: () => ModuleOpportunity[]) => {
    try { all.push(...fn()); } catch { /* one detector failure does not block others */ }
  };

  run(() => detectRepairOpportunities(ctx.repairs, now));
  run(() => detectInventoryOpportunities(ctx.inventory, ctx.sales, now));
  run(() => detectCustomerOpportunities(ctx.customers, ctx.sales, ctx.repairs, ctx.layaways, now));
  run(() => detectLayawayOpportunities(ctx.layaways, now));
  run(() => detectDiscountOpportunities(ctx.sales, now));

  return all.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
}
