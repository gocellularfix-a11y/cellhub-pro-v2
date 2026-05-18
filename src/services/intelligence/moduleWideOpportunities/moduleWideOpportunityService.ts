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
import type { RegistryOpportunity, OpportunityType } from '../opportunities/opportunityRegistry';
import { normalizeOpportunityId } from '../opportunities/opportunityRegistry';

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Severity → 0-100 priority scale used by RegistryOpportunity.
const SEVERITY_PRIORITY: Record<string, number> = { critical: 90, high: 70, medium: 50, low: 30 };

// Maps mwo- id prefixes to canonical OpportunityType values.
const MWO_TYPE_MAP: Array<[string, OpportunityType]> = [
  ['mwo-repair-ready',   'repair_ready'],
  ['mwo-repair-overdue', 'repair_overdue'],
  ['mwo-inv-low',        'inventory_lowstock'],
  ['mwo-inv-dead',       'inventory_deadstock'],
  ['mwo-cust-vip',       'vip_outreach'],
  ['mwo-cust-unpaid',    'unpaid_balance_recovery'],
  ['mwo-lay-over',       'layaway_overdue'],
  ['mwo-lay-near',       'layaway_near_completion'],
  ['mwo-lay-aband',      'layaway_abandoned'],
  ['mwo-disc-excess',    'discount_excessive'],
  ['mwo-disc-emp',       'discount_employee'],
];

function inferType(id: string): OpportunityType {
  for (const [prefix, t] of MWO_TYPE_MAP) {
    if (id.startsWith(prefix)) return t;
  }
  return 'product_push';
}

const MODULE_ENTITY: Record<string, RegistryOpportunity['entityType']> = {
  repairs: 'repair', inventory: 'inventory', customers: 'customer', layaways: 'layaway',
};

function adaptOne(opp: ModuleOpportunity, now: number): RegistryOpportunity {
  const type = inferType(opp.id);
  const entityId = opp.actions?.[0]?.entityId;
  return {
    id: normalizeOpportunityId('module_wide', type, entityId),
    type,
    titleKey: opp.titleKey,
    summaryKey: opp.summaryKey,
    priority: SEVERITY_PRIORITY[opp.severity] ?? 30,
    confidence: opp.confidence,
    source: 'module_wide',
    entityType: MODULE_ENTITY[opp.module],
    entityId,
    evidence: opp.evidence,
    detectedAt: opp.createdAt ?? now,
  };
}

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

// R-INTELLIGENCE-OPPORTUNITY-REGISTRY-V1: adapter that converts module-wide
// opportunities to the canonical RegistryOpportunity envelope. Additive —
// computeModuleWideOpportunities is unchanged; this is a parallel read path.
export function computeModuleOpportunitiesForRegistry(ctx: ModuleWideContext): RegistryOpportunity[] {
  const now = Date.now();
  return computeModuleWideOpportunities(ctx).map((opp) => adaptOne(opp, now));
}
