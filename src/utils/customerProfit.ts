// ============================================================
// CellHub Pro — Customer Profit / Margin Helper
// Pure compute; no React, no persistence, no side effects.
// All computed monetary values are integer cents.
// ============================================================

import type { Sale, SaleItem, InventoryCategory } from '@/store/types';

// R-CUSTOMER-PROFIT-PARITY-V1: narrow settings shape — only the two
// fields the adjustment needs. Avoids importing the full StoreSettings
// type and keeps this util free of cross-module dependencies.
export interface ProfitAdjustmentSettings {
  carrierCommissions?: Record<string, number>;
  defaultCommissionRate?: number;
}

// R-CUSTOMER-PROFIT-PARITY-V1: rewrite per-line `cost` for line items
// whose stored cost doesn't represent the real economic cost of the
// transaction, so downstream lineProfit math (`(price - cost) * qty`)
// reflects reality.
//
// Two cases handled:
//
//  1. phone_payment items — stored cost is 0 because they're services,
//     not inventory. Real "cost" is what the store remits to the carrier.
//     Effective cost = price × (1 − commissionRate). Resolution chain
//     mirrors the canonical chain in TaxReportsModule:
//       stamped item.commissionRate
//       → settings.carrierCommissions[exact carrier name]
//       → settings.carrierCommissions[case-insensitive match]
//       → settings.defaultCommissionRate
//       → 0 (zero commission resolvable ⇒ zero profit, do NOT fabricate)
//
//  2. repair / special_order items — when the stamped cost is 0 (legacy
//     items, services without parts), apply the same 35% fallback used
//     by TaxReportsModule so margins don't show 100% by accident. Items
//     with a stamped cost > 0 are untouched.
//
// All other items (regular products) pass through verbatim.
//
// Returns a NEW sales array if any item needed adjustment; returns the
// caller's array unchanged otherwise (preserves ref equality so React
// memos / Map caches don't churn).
export function adjustSalesItemCosts(
  sales: Sale[],
  settings?: ProfitAdjustmentSettings | null,
): Sale[] {
  const ccs: Record<string, number> = settings?.carrierCommissions || {};
  const defaultRate =
    typeof settings?.defaultCommissionRate === 'number' && settings.defaultCommissionRate > 0
      ? settings.defaultCommissionRate
      : 0;
  const resolveCommRate = (item: SaleItem): number => {
    const stamped = (item as { commissionRate?: number }).commissionRate;
    if (typeof stamped === 'number' && stamped > 0) return stamped;
    const raw = String(
      (item as { carrier?: string; carrierName?: string; provider?: string }).carrier ||
        (item as { carrier?: string; carrierName?: string; provider?: string }).carrierName ||
        (item as { carrier?: string; carrierName?: string; provider?: string }).provider ||
        '',
    ).trim();
    if (raw) {
      if (typeof ccs[raw] === 'number') return ccs[raw];
      const lc = raw.toLowerCase();
      const hit = Object.keys(ccs).find((k) => k.toLowerCase() === lc);
      if (hit && typeof ccs[hit] === 'number') return ccs[hit];
    }
    return defaultRate;
  };

  let anyTouched = false;
  const adjusted = sales.map((sale) => {
    let touched = false;
    const items = (sale.items || []).map((item) => {
      const cat = item.category as string | undefined;
      const price = item.price || 0;
      const stampedCost = typeof item.cost === 'number' ? item.cost : 0;

      if (cat === 'phone_payment') {
        const rate = resolveCommRate(item);
        const correctedCost = Math.round(price * (1 - rate));
        if (item.cost === correctedCost) return item;
        touched = true;
        return { ...item, cost: correctedCost };
      }

      // R-CUSTOMER-PROFIT-PARITY-V1: repair / special_order fallback to
      // 35% of revenue when no parts/labor cost is stamped (matches
      // TaxReportsModule's `defaultRepairCostPct || 0.35`). Once a real
      // cost is stamped at completion, this branch no-ops.
      if ((cat === 'repair' || cat === 'special_order') && stampedCost <= 0 && price > 0) {
        const fallbackCost = Math.round(price * 0.35);
        touched = true;
        return { ...item, cost: fallbackCost };
      }

      return item;
    });
    if (touched) anyTouched = true;
    return touched ? { ...sale, items } : sale;
  });

  return anyTouched ? adjusted : sales;
}

export interface CustomerProfitStats {
  grossRevenue: number;                      // cents
  netRevenue: number;                        // cents
  totalRefunded: number;                     // cents
  profit: number;                            // cents
  margin: number;                            // percentage, e.g. 23.5
  avgTicket: number;                         // cents
  visitCount: number;
  avgDaysBetweenVisits: number | null;
  costCoverage: number;                      // 0..1
  topCategoryByProfit: InventoryCategory | null;
  topCategoryProfit: number;                 // cents
}

// Per-line profit only when cost is known. Returns null when cost is missing
// so callers can distinguish "unknown" from "zero".
function lineProfit(item: SaleItem): number | null {
  if (typeof item.cost !== 'number') return null;
  const price = item.price || 0;
  const qty = item.qty || 0;
  return (price - item.cost) * qty;
}

export function computeCustomerProfit(sales: Sale[], returns: any[]): CustomerProfitStats {
  // Caller pre-filters, but skip voided sales defensively.
  const activeSales = sales.filter((s) => s.status !== 'voided');

  const grossRevenue = activeSales.reduce((s, x) => s + (x.total || 0), 0);

  // Forward-compat: new return records may store totalCents directly;
  // legacy localStorage records store total as dollars.
  const totalRefunded = returns.reduce((s: number, r: any) => {
    const refundCents =
      typeof r.totalCents === 'number'
        ? r.totalCents
        : Math.round((r.total || 0) * 100);
    return s + refundCents;
  }, 0);

  const netRevenue = Math.max(0, grossRevenue - totalRefunded);

  let rawProfit = 0;
  let revenueWithCost = 0;
  const profitByCategory = new Map<InventoryCategory, number>();

  for (const sale of activeSales) {
    for (const item of (sale.items || [])) {
      const lp = lineProfit(item);
      if (lp === null) continue; // cost unknown — excluded from profit + category
      const lineRevenue = (item.price || 0) * (item.qty || 0);
      rawProfit += lp;
      revenueWithCost += lineRevenue;
      if (item.category) {
        profitByCategory.set(item.category, (profitByCategory.get(item.category) || 0) + lp);
      }
    }
  }

  // Refund profit impact — scale refunded revenue by realized margin ratio
  // and subtract from rawProfit. Only meaningful when we have cost data.
  let profit: number;
  if (revenueWithCost > 0 && totalRefunded > 0) {
    const marginRatio = rawProfit / revenueWithCost;
    const profitAdjustment = Math.round(totalRefunded * marginRatio);
    profit = Math.max(0, rawProfit - profitAdjustment);
  } else {
    profit = Math.max(0, rawProfit);
  }

  const margin = netRevenue > 0 ? (profit / netRevenue) * 100 : 0;

  const costCoverage = grossRevenue > 0
    ? Math.min(1, revenueWithCost / grossRevenue)
    : 0;

  const visitCount = activeSales.length;
  const avgTicket = visitCount > 0 ? Math.round(netRevenue / visitCount) : 0;

  // Avg days between consecutive visits. null when < 2 datapoints.
  let avgDaysBetweenVisits: number | null = null;
  if (visitCount >= 2) {
    const times = activeSales
      .map((s) => new Date(s.createdAt as string | Date).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    if (times.length >= 2) {
      const spanMs = times[times.length - 1] - times[0];
      const spanDays = spanMs / (1000 * 60 * 60 * 24);
      avgDaysBetweenVisits = Math.round(spanDays / (times.length - 1));
    }
  }

  // Top category: pick entry with max profit; ties resolve to first-seen
  // (natural Map iteration order).
  let topCategoryByProfit: InventoryCategory | null = null;
  let topCategoryProfit = 0;
  for (const [cat, p] of profitByCategory) {
    if (p > topCategoryProfit) {
      topCategoryProfit = p;
      topCategoryByProfit = cat;
    }
  }

  return {
    grossRevenue,
    netRevenue,
    totalRefunded,
    profit,
    margin,
    avgTicket,
    visitCount,
    avgDaysBetweenVisits,
    costCoverage,
    topCategoryByProfit,
    topCategoryProfit,
  };
}
