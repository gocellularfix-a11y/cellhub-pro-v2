// R-INTEL-PHASE2C-RC: dead stock root cause detector
// For each inventory item with no sale in 30+ days, classifies WHY
// it is not moving: no_demand, low_visibility, pricing_issue, or mixed.
// Returns sorted array (worst offenders first). Empty array if none.
import type { InventoryItem, Sale } from '@/store/types';
import type { DeadStockRootCauseReport, ActionItem } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';

const DEAD_THRESHOLD_DAYS = 30;
const SALES_WINDOW_DAYS   = 60;
const WEEKS_IN_WINDOW     = SALES_WINDOW_DAYS / 7;
const OVERSTOCK_WEEKS     = 6;      // qty / avgWeekly > 6 weeks → low visibility
const HIGH_MARGIN_PCT     = 50;     // margin > 50% → potential pricing issue
const LOW_VELOCITY        = 0.5;    // < 0.5 units/week = suppressed demand

const ITEM_ACTIONS: Record<string, ActionItem[]> = {
  no_demand: [
    { labelKey: 'chat.deadStock.action.discount_item', effort: 'low',    priority: 1 },
    { labelKey: 'chat.deadStock.action.bundle_item',   effort: 'medium', priority: 2 },
    { labelKey: 'chat.deadStock.action.move_display',  effort: 'low',    priority: 3 },
  ],
  low_visibility: [
    { labelKey: 'chat.deadStock.action.move_display',  effort: 'low',    priority: 1 },
    { labelKey: 'chat.deadStock.action.promote_item',  effort: 'low',    priority: 2 },
    { labelKey: 'chat.deadStock.action.bundle_item',   effort: 'medium', priority: 3 },
  ],
  pricing_issue: [
    { labelKey: 'chat.deadStock.action.review_price',  effort: 'low',    priority: 1 },
    { labelKey: 'chat.deadStock.action.discount_item', effort: 'low',    priority: 2 },
    { labelKey: 'chat.deadStock.action.promote_item',  effort: 'low',    priority: 3 },
  ],
  mixed: [
    { labelKey: 'chat.deadStock.action.discount_item', effort: 'low',    priority: 1 },
    { labelKey: 'chat.deadStock.action.move_display',  effort: 'low',    priority: 2 },
    { labelKey: 'chat.deadStock.action.promote_item',  effort: 'low',    priority: 3 },
  ],
};

export function diagnoseDeadStock(
  inventory: InventoryItem[],
  sales: Sale[],
): DeadStockRootCauseReport[] {
  const now = Date.now();
  const windowStart = getDaysAgo(SALES_WINDOW_DAYS);
  const recentSales = sales.filter(
    s => s.status !== 'voided' && new Date(s.createdAt as string) >= windowStart,
  );
  const allSales = sales.filter(s => s.status !== 'voided');

  const reports: DeadStockRootCauseReport[] = [];

  for (const item of inventory) {
    const qty = item.qty || 0;
    if (qty <= 0) continue;

    // All-time sales for this item (id or name match — same as InventoryAnalyzer)
    const itemAllSales = allSales.filter(s =>
      (s.items || []).some((si: any) => si.inventoryId === item.id || si.name === item.name),
    );

    // Last sale date; fall back to item creation date when never sold
    const lastSaleDate = itemAllSales.reduce<Date | null>((latest, s) => {
      const d = new Date(s.createdAt as string);
      return !latest || d > latest ? d : latest;
    }, null);

    const lastSaleDaysAgo = lastSaleDate
      ? Math.floor((now - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24))
      : Math.floor((now - new Date(item.createdAt as string).getTime()) / (1000 * 60 * 60 * 24));

    if (lastSaleDaysAgo <= DEAD_THRESHOLD_DAYS) continue;

    // Velocity over 60-day window
    const recentItemSales = recentSales.filter(s =>
      (s.items || []).some((si: any) => si.inventoryId === item.id || si.name === item.name),
    );
    let recentQty = 0;
    for (const sale of recentItemSales) {
      for (const si of (sale.items || []) as any[]) {
        if (si.inventoryId === item.id || si.name === item.name) {
          recentQty += si.qty || 1;
        }
      }
    }
    const avgWeeklySales = recentQty / WEEKS_IN_WINDOW;

    // Margin (null when cost is unknown / zero)
    const price = item.price || 0;
    const cost  = item.cost  || 0;
    const marginPct = (price > 0 && cost > 0)
      ? ((price - cost) / price) * 100
      : null;

    // Diagnosis rules (task-specified order)
    let diagnosis: DeadStockRootCauseReport['diagnosis'];

    if (avgWeeklySales === 0 && lastSaleDaysAgo > DEAD_THRESHOLD_DAYS) {
      diagnosis = 'no_demand';
    } else if (avgWeeklySales > 0 && qty / avgWeeklySales > OVERSTOCK_WEEKS) {
      diagnosis = 'low_visibility';
    } else if (marginPct !== null && marginPct > HIGH_MARGIN_PCT && avgWeeklySales < LOW_VELOCITY) {
      diagnosis = 'pricing_issue';
    } else {
      diagnosis = 'mixed';
    }

    reports.push({
      sku: item.id,
      name: item.name,
      daysWithoutSale: lastSaleDaysAgo,
      stockUnits: qty,
      avgWeeklySales: Math.round(avgWeeklySales * 100) / 100,
      lastSaleDaysAgo,
      marginPct: marginPct !== null ? Math.round(marginPct * 10) / 10 : null,
      diagnosis,
      confidence: Math.min(1, lastSaleDaysAgo / 30),
      actions: ITEM_ACTIONS[diagnosis],
    });
  }

  // Highest impact first (stock units × days without sale)
  return reports.sort((a, b) => (b.stockUnits * b.lastSaleDaysAgo) - (a.stockUnits * a.lastSaleDaysAgo));
}
