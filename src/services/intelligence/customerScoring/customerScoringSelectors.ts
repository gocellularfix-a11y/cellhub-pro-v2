// CellHub Intelligence — Customer Scoring Selectors
// High-level selectors. Build indexes once per call to avoid O(C×N) loops.

import type { Customer, Sale, Repair, Layaway, Unlock } from '@/store/types';
import type { CustomerBusinessProfile, CustomerTier } from './customerScoringTypes';
import { computeCustomerProfile } from './customerScoringEngine';

// ── Index builder (single pass over each collection) ─────────────────────────

interface CustomerIndexes {
  salesByCustomer: Map<string, Sale[]>;
  repairsByCustomer: Map<string, Repair[]>;
  layawaysByCustomer: Map<string, Layaway[]>;
  unlocksByCustomer: Map<string, Unlock[]>;
}

function buildIndexes(
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
): CustomerIndexes {
  const salesByCustomer = new Map<string, Sale[]>();
  for (const s of sales) {
    if (!s.customerId) continue;
    const arr = salesByCustomer.get(s.customerId);
    if (arr) arr.push(s); else salesByCustomer.set(s.customerId, [s]);
  }

  const repairsByCustomer = new Map<string, Repair[]>();
  for (const r of repairs) {
    if (!r.customerId) continue;
    const arr = repairsByCustomer.get(r.customerId);
    if (arr) arr.push(r); else repairsByCustomer.set(r.customerId, [r]);
  }

  const layawaysByCustomer = new Map<string, Layaway[]>();
  for (const l of layaways) {
    if (!l.customerId) continue;
    const arr = layawaysByCustomer.get(l.customerId);
    if (arr) arr.push(l); else layawaysByCustomer.set(l.customerId, [l]);
  }

  const unlocksByCustomer = new Map<string, Unlock[]>();
  for (const u of unlocks) {
    if (!u.customerId) continue;
    const arr = unlocksByCustomer.get(u.customerId);
    if (arr) arr.push(u); else unlocksByCustomer.set(u.customerId, [u]);
  }

  return { salesByCustomer, repairsByCustomer, layawaysByCustomer, unlocksByCustomer };
}

function profileFromIndex(customer: Customer, idx: CustomerIndexes): CustomerBusinessProfile {
  return computeCustomerProfile({
    customer,
    sales:    idx.salesByCustomer.get(customer.id)    ?? [],
    repairs:  idx.repairsByCustomer.get(customer.id)  ?? [],
    layaways: idx.layawaysByCustomer.get(customer.id) ?? [],
    unlocks:  idx.unlocksByCustomer.get(customer.id)  ?? [],
  });
}

// ── Single-customer selector ───────────────────────────────────────────────────

/**
 * Compute a business profile for one customer.
 * Filters each array once — O(S + R + L + U).
 * Safe to call inside useMemo; pure function.
 */
export function getCustomerBusinessProfile(
  customerId: string,
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
): CustomerBusinessProfile | null {
  const customer = customers.find((c) => c && c.id === customerId);
  if (!customer) return null;

  return computeCustomerProfile({
    customer,
    sales:    sales.filter((s) => s.customerId === customerId),
    repairs:  repairs.filter((r) => r.customerId === customerId),
    layaways: layaways.filter((l) => l.customerId === customerId),
    unlocks:  unlocks.filter((u) => u.customerId === customerId),
  });
}

// ── Multi-customer selectors (build indexes once) ──────────────────────────────

function scoreAll(
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
): CustomerBusinessProfile[] {
  const idx = buildIndexes(sales, repairs, layaways, unlocks);
  return customers.filter(Boolean).map((c) => profileFromIndex(c, idx));
}

export function getVipCustomers(
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
  limit = 10,
): CustomerBusinessProfile[] {
  return scoreAll(customers, sales, repairs, layaways, unlocks)
    .filter((p) => p.estimatedCustomerTier === 'VIP')
    .sort((a, b) => b.vipScore - a.vipScore)
    .slice(0, limit);
}

export function getAtRiskCustomers(
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
  limit = 20,
): CustomerBusinessProfile[] {
  return scoreAll(customers, sales, repairs, layaways, unlocks)
    .filter((p) => p.estimatedCustomerTier === 'At Risk' || p.estimatedCustomerTier === 'Lost')
    .sort((a, b) => b.churnRisk - a.churnRisk)
    .slice(0, limit);
}

export function getHighUpsellCustomers(
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
  limit = 15,
): CustomerBusinessProfile[] {
  return scoreAll(customers, sales, repairs, layaways, unlocks)
    .filter((p) => p.upsellOpportunity >= 50)
    .sort((a, b) => b.upsellOpportunity - a.upsellOpportunity)
    .slice(0, limit);
}

export function getHighCollectionPriorityCustomers(
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
  limit = 15,
): CustomerBusinessProfile[] {
  return scoreAll(customers, sales, repairs, layaways, unlocks)
    .filter((p) => p.collectionPriority >= 30)
    .sort((a, b) => b.collectionPriority - a.collectionPriority)
    .slice(0, limit);
}

/**
 * Shortcut to just get a customer's tier without building the full profile.
 * Still O(S + R + L + U) — use getCustomerBusinessProfile if you need other fields.
 */
export function getCustomerTier(
  customerId: string,
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  unlocks: Unlock[],
): CustomerTier | null {
  const profile = getCustomerBusinessProfile(customerId, customers, sales, repairs, layaways, unlocks);
  return profile?.estimatedCustomerTier ?? null;
}
