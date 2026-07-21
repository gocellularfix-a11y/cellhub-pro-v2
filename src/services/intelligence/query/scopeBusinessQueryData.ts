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
import { classifyItem, isActivationSaleItem, KNOWN_CARRIER_NAME_RE } from '@/services/reports/phonePaymentReporting';
import { isRepairCompleted, isUnlockCompleted } from '@/services/reports/computeReportMoneyStats';
import { isWithinLocalDayRange } from '@/utils/reportRange';
import type { LocalDayRange } from '@/utils/reportRange';
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

// ── I6-0B: STRICT structured carrier classification ─────────
// The legacy itemCarrier() name-prefix fallback exists for legacy phone-
// payment records ("Verizon Bill Payment" items with no carrier field) and
// stays the chat/insights behavior. Its substring test also classifies
// PRODUCT names that merely start with a carrier word ("Ultra Case") — a
// false carrier. Consumers that need a population with STRUCTURAL carrier
// evidence (proactive carrier concentration) use the strict resolver below.

/** Item kinds that represent genuine carrier activity (canonical
 *  classifyItem vocabulary — category/type fields, never names). */
export function isCarrierActivityItem(item: SaleItem): boolean {
  const kind = classifyItem(item);
  return kind === 'phone_payment' || kind === 'topup' || isActivationSaleItem(item);
}

/** STRICT canonical carrier resolution — STRUCTURED evidence only:
 *  1. the item must be genuine carrier activity (phone payment / top-up /
 *     activation by canonical classification) — products, accessories,
 *     repairs, unlocks and services NEVER qualify, whatever their name;
 *  2. the carrier must come from the explicit carrier/carrierName FIELD,
 *     and the ENTIRE field value must be a KNOWN carrier (full-string
 *     match against the canonical shared matcher — a substring hit like
 *     "Ultra Case" never classifies).
 *  item.name / description / SKU / customer data are never consulted.
 *  Returns '' when there is no unambiguous structured carrier. */
export function resolveStructuredCarrier(item: SaleItem): string {
  if (!isCarrierActivityItem(item)) return '';
  const raw = String((item as { carrier?: string }).carrier
    || (item as { carrierName?: string }).carrierName || '').trim();
  if (!raw) return '';
  const m = raw.match(KNOWN_CARRIER_NAME_RE);
  if (!m || m[0].length !== raw.length) return '';
  return normalizeCarrier(raw);
}

export type ItemCarrierResolver = (item: SaleItem) => string;

export interface CarrierScopeResult {
  sales: Sale[];
  excludedMixedSales: number;
}

/** Sales belonging EXACTLY to `carrierCanonical` (every item resolves to
 *  it). `resolver` defaults to the legacy itemCarrier (chat/insights
 *  behavior unchanged); strict consumers pass resolveStructuredCarrier. */
export function scopeSalesByCarrier(sales: Sale[], carrierCanonical: string, resolver: ItemCarrierResolver = itemCarrier): CarrierScopeResult {
  const out: Sale[] = [];
  let excludedMixed = 0;
  for (const s of sales) {
    const items = s.items || [];
    if (items.length === 0) continue;
    const carriers = new Set(items.map(resolver));
    if (carriers.size === 1 && carriers.has(carrierCanonical)) {
      out.push(s);
    } else if (carriers.has(carrierCanonical)) {
      excludedMixed++;   // touches the carrier but not purely — excluded
    }
  }
  return { sales: out, excludedMixedSales: excludedMixed };
}

/** Every distinct canonical carrier present as a PURE single-carrier sale. */
export function discoverCarriers(sales: Sale[], resolver: ItemCarrierResolver = itemCarrier): string[] {
  const found = new Set<string>();
  for (const s of sales) {
    const items = s.items || [];
    if (items.length === 0) continue;
    const carriers = new Set(items.map(resolver));
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

/** Generic record-level employee attribution (Repair/Unlock carry
 *  employeeId/employeeName — exact when populated). */
function belongsToEmployee(rec: { employeeId?: string; employeeName?: string }, employee: { id?: string; name: string }): boolean {
  if (employee.id && rec.employeeId) return rec.employeeId === employee.id;
  return String(rec.employeeName || '').trim().toLowerCase() === employee.name.trim().toLowerCase();
}

/** Records with NO employee attribution at all (unattributable). */
export function hasEmployeeAttribution(rec: { employeeId?: string; employeeName?: string }): boolean {
  return !!(rec.employeeId || (rec.employeeName && String(rec.employeeName).trim()));
}

/** Employee-scoped snapshot: the employee's sales PLUS their attributed
 *  standalone repairs/unlocks (both record types carry employeeId/Name).
 *  Scoping only — canonical service computes all money. */
export function employeeSnapshot(base: CanonicalMoneySnapshot, employee: { id?: string; name: string }): Partial<CanonicalMoneySnapshot> {
  return {
    sales: scopeSalesByEmployee(base.sales || [], employee),
    repairs: (base.repairs || []).filter((r) => belongsToEmployee(r as { employeeId?: string; employeeName?: string }, employee)),
    unlocks: (base.unlocks || []).filter((u) => belongsToEmployee(u as { employeeId?: string; employeeName?: string }, employee)),
    specialOrders: [],
    layaways: [],
    customerReturns: base.customerReturns,
    vendorReturns: [],
    inventory: base.inventory,
    settings: base.settings,
  };
}

/** Carrier-IMPURE sales in a set: any sale that touches at least one carrier
 *  but whose items do not ALL resolve to that single carrier (two carriers,
 *  or carrier + unattributed accessory). These make per-carrier money
 *  inexact — the executor refuses rather than excluding or allocating. */
export function countCarrierImpureSales(sales: Sale[], resolver: ItemCarrierResolver = itemCarrier): number {
  let impure = 0;
  for (const s of sales) {
    const items = s.items || [];
    if (items.length === 0) continue;
    const carriers = new Set(items.map(resolver));
    const named = [...carriers].filter((c) => c !== '');
    if (named.length >= 1 && carriers.size > 1) impure++;
  }
  return impure;
}

/** Every distinct employee name appearing on sales OR attributed standalone
 *  services (for ranking candidates). */
export function discoverEmployees(base: CanonicalMoneySnapshot): string[] {
  const names = new Set<string>();
  const add = (n?: string) => { const t = String(n || '').trim(); if (t) names.add(t); };
  for (const s of base.sales || []) add(s.employeeName);
  for (const r of base.repairs || []) add((r as { employeeName?: string }).employeeName);
  for (const u of base.unlocks || []) add((u as { employeeName?: string }).employeeName);
  return [...names].sort();
}

/** Completed (revenue-contributing) service records in range with NO employee
 *  attribution — their revenue would be silently omitted from any per-employee
 *  answer, so the executor refuses whole-business employee money when > 0. */
export function countUnattributedServiceRecords(base: CanonicalMoneySnapshot, range: LocalDayRange): number {
  const inRange = (createdAt: unknown): boolean => {
    const d = new Date(createdAt as string | Date);
    return !isNaN(d.getTime()) && isWithinLocalDayRange(d, range);
  };
  let count = 0;
  for (const r of base.repairs || []) {
    if (isRepairCompleted(r) && inRange(r.createdAt)
      && !hasEmployeeAttribution(r as { employeeId?: string; employeeName?: string })) count++;
  }
  for (const u of base.unlocks || []) {
    if (isUnlockCompleted(u) && inRange(u.createdAt)
      && !hasEmployeeAttribution(u as { employeeId?: string; employeeName?: string })) count++;
  }
  return count;
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
