// ============================================================
// Structured Query Executor — exact entity scoping (I3-2).
//
// SCOPING ONLY: these helpers SELECT records that belong exactly to an
// entity; the scoped snapshot is then passed through the canonical money
// service. No revenue/cost/profit/tax is computed here.
//
// Exactness rules (documented in the support matrix):
// - employee: sale-level attribution (employeeId / employeeName) — exact.
// - carrier: a sale belongs to carrier C only when EVERY item resolves to C
//   (pure single-carrier sales, the phone-payment norm). Sales with items
//   resolving to a different/multiple carriers are EXCLUDED and counted in
//   diagnostics — exact-or-exclude, never proportional allocation.
// - customer: canonical customerMoneyProfile (not scoped here).
// - payment_provider / category / product: canonical aggregation rows from
//   computeReportMoneyStats (no scoping needed).
// ============================================================

import type { Sale, SaleItem } from '@/store/types';
import { normalizeCarrier } from '@/utils/normalize';
import { KNOWN_CARRIER_NAME_RE } from '@/services/reports/phonePaymentReporting';
import type { CanonicalMoneySnapshot } from '../adapters/reportMoneyAdapter';

/** Resolve the carrier of a single sale item (same field precedence the
 *  canonical phone-payment classifier uses for its carrier lookup; the
 *  name-prefix fallback only fires for KNOWN carrier names via the canonical
 *  shared matcher). Returns '' when the item carries no carrier signal. */
export function itemCarrier(item: SaleItem): string {
  const raw = String((item as { carrier?: string }).carrier
    || (item as { carrierName?: string }).carrierName || '').trim();
  // Field value must be a KNOWN carrier (never a payment-provider name that
  // leaked into a shared field) — carrier ≠ payment_provider, always.
  if (raw && KNOWN_CARRIER_NAME_RE.test(raw)) return normalizeCarrier(raw);
  const head = item.name ? item.name.split(/[-–]|Bill Payment/i)[0].trim() : '';
  if (head && KNOWN_CARRIER_NAME_RE.test(head)) return normalizeCarrier(head);
  return '';
}

export interface CarrierScopeResult {
  sales: Sale[];
  excludedMixedSales: number;
}

/** Sales belonging EXACTLY to `carrierCanonical` (every item resolves to it). */
export function scopeSalesByCarrier(sales: Sale[], carrierCanonical: string): CarrierScopeResult {
  const out: Sale[] = [];
  let excludedMixed = 0;
  for (const s of sales) {
    const items = s.items || [];
    if (items.length === 0) continue;
    const carriers = new Set(items.map(itemCarrier));
    if (carriers.size === 1 && carriers.has(carrierCanonical)) {
      out.push(s);
    } else if (carriers.has(carrierCanonical)) {
      excludedMixed++;   // touches the carrier but not purely — excluded
    }
  }
  return { sales: out, excludedMixedSales: excludedMixed };
}

/** Every distinct canonical carrier present as a PURE single-carrier sale. */
export function discoverCarriers(sales: Sale[]): string[] {
  const found = new Set<string>();
  for (const s of sales) {
    const items = s.items || [];
    if (items.length === 0) continue;
    const carriers = new Set(items.map(itemCarrier));
    if (carriers.size === 1) {
      const only = [...carriers][0];
      if (only) found.add(only);
    }
  }
  return [...found].sort();
}

/** Sales attributed to one employee (sale-level attribution — exact). */
export function scopeSalesByEmployee(sales: Sale[], employee: { id?: string; name: string }): Sale[] {
  const nameLc = employee.name.trim().toLowerCase();
  return sales.filter((s) => {
    const sid = (s as { employeeId?: string }).employeeId;
    if (employee.id && sid) return sid === employee.id;
    return String(s.employeeName || '').trim().toLowerCase() === nameLc;
  });
}

/** Every distinct employee name appearing on sales (for ranking candidates). */
export function discoverEmployees(sales: Sale[]): string[] {
  const names = new Set<string>();
  for (const s of sales) {
    const n = String(s.employeeName || '').trim();
    if (n) names.add(n);
  }
  return [...names].sort();
}

/** Snapshot scoped to a subset of sales; repairs/unlocks/layaways/SOs are
 *  dropped because entity attribution for standalone records is sale-level
 *  only in these dimensions (kept exact — never guessed). Returns are kept:
 *  the canonical service links them to the scoped sales by stable IDs. */
export function snapshotWithSales(base: CanonicalMoneySnapshot, sales: Sale[]): Partial<CanonicalMoneySnapshot> {
  return {
    sales,
    repairs: [],
    unlocks: [],
    specialOrders: [],
    layaways: [],
    customerReturns: base.customerReturns,
    vendorReturns: [],
    inventory: base.inventory,
    settings: base.settings,
  };
}

/** POS-only snapshot (sales population, standalone services removed) — the
 *  approved average-ticket population. Scoping only. */
export function posOnlySnapshot(base: CanonicalMoneySnapshot): Partial<CanonicalMoneySnapshot> {
  return snapshotWithSales(base, base.sales || []);
}
