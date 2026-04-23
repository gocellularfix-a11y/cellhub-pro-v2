// ============================================================
// CellHub Pro — Customer Profit / Margin Helper
// Pure compute; no React, no persistence, no side effects.
// All computed monetary values are integer cents.
// ============================================================

import type { Sale, SaleItem, InventoryCategory } from '@/store/types';

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
