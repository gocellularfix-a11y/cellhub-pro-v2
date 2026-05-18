// R-NEXT-BEST-ACTION-ENGINE-V1
// Deterministic weighted scoring: ranks ModuleOpportunity[] into ONE primary
// next-best action + ordered secondary list. No AI, no embeddings.
// Inputs: severity, recommendedAction type, module priority.

import type { ModuleOpportunity } from '../moduleWideOpportunities/moduleWideOpportunityTypes';

export interface NBAResult {
  primary: ModuleOpportunity;
  secondary: ModuleOpportunity[];
}

// ── Scoring tables ────────────────────────────────────────────────────────────

const SEVERITY_SCORE: Record<string, number> = {
  critical: 1000,
  high:      600,
  medium:    300,
  low:       100,
};

// Higher weight = more urgent / more revenue impact
const ACTION_WEIGHT: Record<string, number> = {
  deliver_unlock_code:         60,
  notify_customer_pickup:      55,
  notify_customer_so_arrival:  50,
  notify_customer_arrival:     50,
  contact_layaway_overdue:     45,
  collect_balance:             40,
  follow_up_supplier:          25,
  update_repair_status:        20,
  encourage_final_payment:     20,
  reorder:                     15,
  contact_customer:            10,
  discount_or_bundle:           5,
  discuss_protection_plan:      0,
};

// Tiebreaker — operational modules rank above informational ones
const MODULE_ORDER: Record<string, number> = {
  repairs:        5,
  customers:      4,
  layaways:       3,
  unlocks:        2,
  special_orders: 1,
  inventory:      0,
};

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreOpportunity(opp: ModuleOpportunity): number {
  const sev = SEVERITY_SCORE[opp.severity] ?? 100;
  const act = ACTION_WEIGHT[opp.recommendedAction ?? ''] ?? 0;
  const mod = MODULE_ORDER[opp.module] ?? 0;
  return sev + act + mod;
}

// ── Public entry point ────────────────────────────────────────────────────────

export function rankOpportunitiesForNBA(opps: ModuleOpportunity[]): NBAResult | null {
  if (opps.length === 0) return null;
  const sorted = opps
    .map((o) => ({ opp: o, score: scoreOpportunity(o) }))
    .sort((a, b) => b.score - a.score);
  const [first, ...rest] = sorted;
  return {
    primary: first.opp,
    secondary: rest.map((x) => x.opp),
  };
}
