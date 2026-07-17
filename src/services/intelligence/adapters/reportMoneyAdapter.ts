// ============================================================
// CellHub Intelligence — Canonical Report-Money Adapter
// (CELLHUB-INTELLIGENCE-I2A)
//
// Financial calculations are owned by computeReportMoneyStats. This adapter
// performs DATA WIRING and FIELD MAPPING only.
//
// It builds the complete ReportMoneyStatsInput from the Intelligence store
// snapshot (sales, repairs, unlocks, special orders, layaways, inventory,
// customer returns, vendor returns, settings), constructs canonical
// LOCAL-day ranges with the same helper Reports uses, injects non-UI
// fallback labels, and invokes the canonical service.
//
// FORBIDDEN here (and enforced by the parity suite): status filtering,
// reduce-over-totals, gross−returns, revenue−cost, tax math, clamping,
// rounding policy, estimation. If a number looks wrong, fix it in
// computeReportMoneyStats — never here.
// ============================================================

import type {
  Sale, Repair, Unlock, SpecialOrder, Layaway, InventoryItem, CustomerReturn, StoreSettings,
} from '@/store/types';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { ReportMoneyStats, ReportMoneyStatsInput } from '@/services/reports/computeReportMoneyStats';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import type { LocalDayRange } from '@/utils/reportRange';

/**
 * I2A.1 — every StoreSettings field computeReportMoneyStats actually reads
 * (verified consumption sites):
 *   - carrierCommissions / defaultCommissionRate → computePhonePaymentEconomics
 *     (commission economics; consumed via the CommissionSettings Pick)
 *   - paymentPortals → getActivePortals (provider bucketing; falls back to
 *     DEFAULT_PAYMENT_PORTALS when absent)
 *   - carrierPortalUrls → provider portal mapping (defensive `|| {}` read)
 * Tax / CBE / screen-fee AMOUNTS are stamped on sales at checkout — the
 * canonical service reads NO tax-rate settings. Settings are GLOBAL in
 * AppState (never store-scoped) — same object Reports receives.
 */
export type CanonicalMoneySettings = Partial<Pick<StoreSettings,
  'carrierCommissions' | 'defaultCommissionRate' | 'carrierPortalUrls' | 'paymentPortals'>>;

/** Everything the canonical service needs, as Intelligence holds it.
 *  Collections are the AppProvider filteredState arrays — already scoped by
 *  the canonical store policy (src/store/storeScope.ts): single-store =
 *  selected store + legacy no-storeId records; consolidated = all stores. */
export interface CanonicalMoneySnapshot {
  sales: Sale[];
  repairs: Repair[];
  unlocks: Unlock[];
  specialOrders: SpecialOrder[];
  layaways: Layaway[];
  inventory: InventoryItem[];
  customerReturns: CustomerReturn[];
  vendorReturns: unknown[];
  settings: CanonicalMoneySettings;
}

// Non-UI fallback labels (chat handlers re-localize their own text; these
// only name buckets inside the canonical tables).
const FALLBACK_LABELS = {
  noProvider: '(No provider)',
  noCarrier: '(No carrier)',
  unknownEmployee: 'Unknown',
} as const;

/** Local YMD — same convention as ReportsModule's toLocalYMD (never UTC). */
export function toLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One local calendar day: 00:00:00.000 → 23:59:59.999 local time, via the
 *  SAME canonical helper Reports uses (inclusive boundaries, DST-safe by
 *  construction — `new Date('YMD T00:00:00')` resolves in local time). */
export function localDayRangeForDay(d: Date): LocalDayRange {
  const ymd = toLocalYMD(d);
  return normalizeLocalDayRange(ymd, ymd);
}

/** The chat's coarse ranges, expressed as canonical LOCAL-day ranges with
 *  the SAME semantics the previous getDateBounds implemented:
 *  today · yesterday · Sunday-anchored this_week · calendar this_month ·
 *  rolling last_30_days (all ending today, inclusive). Pure date math —
 *  no money. */
export type IntelDateRange = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days';

export function localDayRangeForIntelRange(range: IntelDateRange, now: Date = new Date()): LocalDayRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shiftDays = (base: Date, days: number): Date =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  switch (range) {
    case 'today':
      return normalizeLocalDayRange(toLocalYMD(today), toLocalYMD(today));
    case 'yesterday': {
      const y = shiftDays(today, -1);
      return normalizeLocalDayRange(toLocalYMD(y), toLocalYMD(y));
    }
    case 'this_week': {
      const start = shiftDays(today, -today.getDay()); // Sunday-anchored
      return normalizeLocalDayRange(toLocalYMD(start), toLocalYMD(today));
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return normalizeLocalDayRange(toLocalYMD(start), toLocalYMD(today));
    }
    case 'last_30_days':
    default: {
      const start = shiftDays(today, -30);
      return normalizeLocalDayRange(toLocalYMD(start), toLocalYMD(today));
    }
  }
}

/** THE single entry point: full snapshot + canonical range → canonical
 *  stats. Never mutates inputs; contains zero financial arithmetic. */
export function computeCanonicalMoneyForRange(
  snapshot: CanonicalMoneySnapshot,
  periodRange: LocalDayRange,
): ReportMoneyStats {
  const input: ReportMoneyStatsInput = {
    sales: snapshot.sales || [],
    repairs: snapshot.repairs || [],
    unlocks: snapshot.unlocks || [],
    specialOrders: snapshot.specialOrders || [],
    layaways: snapshot.layaways || [],
    inventory: snapshot.inventory || [],
    customerReturns: snapshot.customerReturns || [],
    vendorReturns: snapshot.vendorReturns || [],
    // I2A.1: THE single, documented type boundary. The canonical service's
    // signature asks for StoreSettings but its verified reads are exactly
    // the CanonicalMoneySettings fields above — all consumed defensively
    // (Pick / `|| {}` / default portals). At runtime both real callers
    // (Reports and IntelligenceModule) pass the SAME global state.settings.
    settings: (snapshot.settings || {}) as StoreSettings,
    periodRange,
    labels: FALLBACK_LABELS,
  };
  return computeReportMoneyStats(input);
}
