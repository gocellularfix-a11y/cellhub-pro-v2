// CellHub Intelligence — Canonical Opportunity Registry
//
// Problem this solves:
//   Opportunity-generating logic is scattered across handlers.ts, dailyBrief,
//   buyTodayRanking, moduleWideOpportunities, revenueOpportunities, and context
//   detectors — each with its own shape, priority scale, and dedup strategy.
//   The result: duplicate recommendations, inconsistent ordering, and repeated
//   action buttons surfacing different versions of the same opportunity.
//
// What this file is:
//   - RegistryOpportunity: canonical envelope type all sources can adapt to.
//   - Pure helper functions: normalizeOpportunityId, dedupeOpportunities,
//     sortOpportunities, limitOpportunities. Deterministic, no I/O.
//
// What this file is NOT:
//   - A replacement for existing types (BuyTodayCandidate, ModuleOpportunity,
//     RevenueOpportunity). Those stay frozen.
//   - A new execution or persistence layer.
//
// Migration path (do NOT rush — adapt one source at a time):
//   Phase 1 (done): registry type + helpers + module_wide adapter
//     moduleWideOpportunityService.computeModuleOpportunitiesForRegistry()
//   Phase 2: adapt revenueOpportunityEngine → RegistryOpportunity
//     Use adaptRevenueOpportunity() pattern (see module_wide adapter for pattern)
//   Phase 3: adapt buyTodayRanking output → RegistryOpportunity
//     BuyTodayCandidate already has type + score — straightforward mapping
//   Phase 4: adapt handlers.ts opportunity-source ad-hoc arrays
//     Replace { title, reason, action, rank } with RegistryOpportunity, call
//     dedupeOpportunities + sortOpportunities before slice
//   Phase 5: adapt dailyBrief + contextualOpportunityService
//     Both already emit severity — map critical→90, high→70, medium→50, low→30

// ── Opportunity taxonomy ───────────────────────────────────────────────────────

export type OpportunityType =
  // Repair
  | 'repair_ready'
  | 'repair_overdue'
  | 'delayed_repair_recovery'
  // Customer
  | 'vip_outreach'
  | 'vip_retention'
  | 'inactive_high_value'
  | 'inactive_customer_recovery'
  | 'high_value_followup'
  | 'recent_interest'
  | 'outreach'
  // Payment / Financial
  | 'payment_due'
  | 'unpaid_balance_recovery'
  | 'missed_revenue'
  | 'missed_accessory_attach'
  // Inventory
  | 'dead_stock_push'
  | 'inventory_deadstock'
  | 'low_stock_reorder'
  | 'inventory_lowstock'
  // Layaway
  | 'layaway_overdue'
  | 'layaway_near_completion'
  | 'layaway_abandoned'
  // Deal / Sales
  | 'pending_deals'
  // Workflow
  | 'abandoned_workflow_recovery'
  // Operational
  | 'discount_excessive'
  | 'discount_employee'
  // Product
  | 'product_push';

export type OpportunitySource =
  | 'buy_today_ranking'
  | 'module_wide'
  | 'contextual'
  | 'revenue_signals'
  | 'handlers_chat'
  | 'daily_brief';

export type RegistryActionType =
  | 'whatsapp'
  | 'open_customer'
  | 'open_repair'
  | 'open_inventory'
  | 'open_layaway'
  | 'query';

export interface RegistryOpportunityAction {
  label: string;
  actionType: RegistryActionType;
  payload?: Record<string, unknown>;
}

// ── Canonical opportunity envelope ────────────────────────────────────────────

export interface RegistryOpportunity {
  /** Stable deterministic ID — use normalizeOpportunityId() to produce. */
  id: string;
  type: OpportunityType;
  /** i18n key for the opportunity title. */
  titleKey: string;
  /** i18n key for the detail/reason text. Optional. */
  summaryKey?: string;
  /** 0–100 composite priority. Higher surfaces first. */
  priority: number;
  confidence: 'high' | 'medium' | 'low';
  source: OpportunitySource;
  entityType?: 'customer' | 'repair' | 'inventory' | 'layaway' | 'deal' | 'product';
  entityId?: string;
  /** Conservative recoverable/impact amount in cents. 0 = unknown. */
  estimatedValueCents?: number;
  actions?: RegistryOpportunityAction[];
  /** Human-readable signals that triggered detection. */
  evidence?: string[];
  detectedAt: number;
}

// ── Pure helper functions ─────────────────────────────────────────────────────

/**
 * Produces a stable, deterministic registry ID.
 * Format: `reg:{source}:{type}:{entityId|global}`
 *
 * The source is included so two different detectors for the same entity
 * produce distinct IDs. Use dedupeOpportunities() to collapse them by
 * semantic identity (type + entityId) keeping highest priority.
 */
export function normalizeOpportunityId(
  source: OpportunitySource,
  type: OpportunityType,
  entityId?: string,
): string {
  return `reg:${source}:${type}:${entityId ?? 'global'}`;
}

// Dedup key: semantic identity ignores source — same type + entity from
// different detectors is the same real-world opportunity.
function dedupeKey(opp: RegistryOpportunity): string {
  return `${opp.type}:${opp.entityId ?? 'global'}`;
}

/**
 * Removes duplicate opportunities by semantic identity (type + entityId).
 * When duplicates exist, keeps the entry with the highest priority.
 * Input order has no effect on which duplicate wins — priority does.
 */
export function dedupeOpportunities(
  opps: RegistryOpportunity[],
): RegistryOpportunity[] {
  const best = new Map<string, RegistryOpportunity>();
  for (const opp of opps) {
    const key = dedupeKey(opp);
    const existing = best.get(key);
    if (!existing || opp.priority > existing.priority) {
      best.set(key, opp);
    }
  }
  return Array.from(best.values());
}

/**
 * Sorts opportunities by priority descending, then detectedAt descending.
 * Returns a new array — does not mutate input.
 */
export function sortOpportunities(
  opps: RegistryOpportunity[],
): RegistryOpportunity[] {
  return opps.slice().sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.detectedAt - a.detectedAt;
  });
}

/**
 * Returns the top N opportunities after sorting. Pure slice — no side effects.
 * Combine with sortOpportunities: limitOpportunities(sortOpportunities(opps), 5)
 */
export function limitOpportunities(
  opps: RegistryOpportunity[],
  n: number,
): RegistryOpportunity[] {
  return opps.slice(0, n);
}
