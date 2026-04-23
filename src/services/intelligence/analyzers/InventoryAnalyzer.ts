// CellHub Intelligence — Inventory Analyzer
import type { InventoryItem } from '@/store/types';
import { Insight, InventoryMetrics } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';
import { exponentialSmoothing } from '../utils/statistics';

export interface InventoryThresholds {
  deadStockDays: number;
  reorderPointDays: number;
  overstockDays: number;
  lowStockThreshold: number;
  agingThresholdDays: number;
}

const DEFAULT_THRESHOLDS: InventoryThresholds = {
  deadStockDays: 60,
  reorderPointDays: 7,
  overstockDays: 90,
  lowStockThreshold: 5,
  agingThresholdDays: 45,
};

export class InventoryAnalyzer {
  private inventory: InventoryItem[];
  private sales: any[];
  private thresholds: InventoryThresholds;
  private lang: string;

  constructor(
    inventory: InventoryItem[],
    sales: any[],
    thresholds: InventoryThresholds = DEFAULT_THRESHOLDS,
    lang: string = 'en'
  ) {
    this.inventory = inventory;
    this.sales = sales;
    this.thresholds = thresholds;
    this.lang = lang;
  }

  getMetrics(): InventoryMetrics {
    const totalValue = this.inventory.reduce((sum, i) => sum + (i.price || 0) * Math.max(0, i.qty || 0), 0);
    const totalItems = this.inventory.length;

    const deadStock = this.getDeadStock();
    const reorderAlerts = this.getReorderAlerts();

    const categoryDist: Record<string, number> = {};
    for (const item of this.inventory) {
      const cat = item.category || 'unknown';
      categoryDist[cat] = (categoryDist[cat] || 0) + ((item.price || 0) * (item.qty || 0));
    }

    return {
      totalValue,
      totalItems,
      deadStockCount: deadStock.length,
      reorderAlertCount: reorderAlerts.length,
      categoryDistribution: categoryDist,
    };
  }

  getDeadStock(): InventoryItem[] {
    const cutoff = getDaysAgo(this.thresholds.deadStockDays);
    return this.inventory.filter(item => {
      if ((item.qty || 0) <= 0) return false;
      const created = new Date(item.createdAt as string);
      if (created > cutoff) return false;
      const salesOfItem = this.sales.filter(s => {
        for (const si of (s.items || [])) {
          if (si.inventoryId === item.id || si.name === item.name) return true;
        }
        return false;
      });
      return salesOfItem.length === 0;
    });
  }

  getReorderAlerts(): { item: InventoryItem; avgDailySales: number; daysLeft: number }[] {
    const result: { item: InventoryItem; avgDailySales: number; daysLeft: number }[] = [];
    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(30);
    });

    for (const item of this.inventory) {
      const qty = item.qty || 0;
      if (qty <= 0) continue;

      let salesQty = 0;
      for (const sale of recentSales) {
        for (const si of (sale.items || [])) {
          if (si.inventoryId === item.id || si.name === item.name) {
            salesQty += si.qty || 1;
          }
        }
      }
      const avgDailySales = salesQty / 30;
      if (avgDailySales > 0) {
        const daysLeft = qty / avgDailySales;
        if (daysLeft <= this.thresholds.reorderPointDays) {
          result.push({ item, avgDailySales, daysLeft });
        }
      }
    }
    return result.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  getOverstock(): { item: InventoryItem; daysOfSupply: number }[] {
    const result: { item: InventoryItem; daysOfSupply: number }[] = [];
    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(90);
    });

    for (const item of this.inventory) {
      const qty = item.qty || 0;
      if (qty <= 0) continue;

      let salesQty = 0;
      for (const sale of recentSales) {
        for (const si of (sale.items || [])) {
          if (si.inventoryId === item.id || si.name === item.name) {
            salesQty += si.qty || 1;
          }
        }
      }
      const avgDailySales = salesQty / 90;
      if (avgDailySales > 0) {
        const daysOfSupply = qty / avgDailySales;
        if (daysOfSupply >= this.thresholds.overstockDays) {
          result.push({ item, daysOfSupply });
        }
      }
    }
    return result.sort((a, b) => b.daysOfSupply - a.daysOfSupply);
  }

  getIMEIAging(): { item: InventoryItem; daysSinceCreated: number }[] {
    const cutoff = getDaysAgo(this.thresholds.agingThresholdDays);
    return this.inventory
      .filter(item => {
        if (!item.imei) return false;
        const created = new Date(item.createdAt as string);
        return created <= cutoff && (item.qty || 0) > 0;
      })
      .map(item => ({
        item,
        daysSinceCreated: Math.floor((Date.now() - new Date(item.createdAt as string).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.daysSinceCreated - a.daysSinceCreated);
  }

  // R-INTEL-SMARTER-F2: velocity-based dead-stock ranking.
  // The legacy getDeadStock() is BINARY — 0 sales in 60 days = dead.
  // An item with 1 sale in 60 days gets the same "alive" rating as
  // one selling daily. This method scores continuous "liveness" 0..1
  // using exponentialSmoothing on daily sales, so "dying" items are
  // flagged BEFORE they hit fully-dead status.
  //
  // Score interpretation:
  //   0.00–0.10  dying (likely dead in next 30 days)
  //   0.10–0.30  slow
  //   0.30–0.70  moderate
  //   0.70–1.00  healthy / hot
  getDeadStockByVelocity(windowDays: number = 90): Array<{
    item: InventoryItem;
    velocityScore: number;
    daysSinceLastSale: number | null;
    salesLastWindow: number;
  }> {
    const windowStart = getDaysAgo(windowDays);
    const recentSales = this.sales.filter(s => {
      const d = new Date(s.createdAt as string);
      return d >= windowStart && s.status !== 'voided';
    });

    const result: Array<{
      item: InventoryItem;
      velocityScore: number;
      daysSinceLastSale: number | null;
      salesLastWindow: number;
    }> = [];

    // Peak smoothed value observed across all items — normalizes scores to 0..1
    // relative to the hottest SKU in the shop. Computed in a first pass.
    const rawByItem = new Map<string, { series: number[]; lastSaleDay: number | null; total: number }>();

    for (const item of this.inventory) {
      if ((item.qty || 0) <= 0) continue;
      const byDay: number[] = new Array(windowDays).fill(0);
      let lastSaleDay: number | null = null;
      let total = 0;
      for (const sale of recentSales) {
        const dayIdx = Math.floor(
          (new Date(sale.createdAt as string).getTime() - windowStart.getTime())
          / (1000 * 60 * 60 * 24),
        );
        for (const si of sale.items || []) {
          if (si.inventoryId === item.id || si.name === item.name) {
            const qty = si.qty || 0;
            byDay[dayIdx] = (byDay[dayIdx] || 0) + qty;
            total += qty;
            if (lastSaleDay === null || dayIdx > lastSaleDay) lastSaleDay = dayIdx;
          }
        }
      }
      rawByItem.set(item.id, { series: byDay, lastSaleDay, total });
    }

    // Compute smoothed signal per item. alpha=0.3 weights recent sales
    // higher than old ones — responds to slowdowns without being jittery.
    let peak = 0;
    const smoothedByItem = new Map<string, number>();
    for (const [itemId, entry] of rawByItem) {
      const smoothed = exponentialSmoothing(entry.series, 0.3);
      const latest = smoothed[smoothed.length - 1] || 0;
      smoothedByItem.set(itemId, latest);
      if (latest > peak) peak = latest;
    }

    // Normalize to 0..1 relative to peak; if peak is zero, every item is dying.
    for (const item of this.inventory) {
      if ((item.qty || 0) <= 0) continue;
      const raw = rawByItem.get(item.id);
      if (!raw) continue;
      const smoothed = smoothedByItem.get(item.id) || 0;
      const velocityScore = peak > 0 ? smoothed / peak : 0;
      const daysSinceLastSale = raw.lastSaleDay !== null
        ? windowDays - 1 - raw.lastSaleDay
        : null;

      result.push({
        item,
        velocityScore,
        daysSinceLastSale,
        salesLastWindow: raw.total,
      });
    }

    return result.sort((a, b) => a.velocityScore - b.velocityScore);
  }

  getInventoryTurnoverRate(): number {
    const costValue = this.inventory.reduce((sum, i) => sum + ((i.cost || 0) * Math.max(0, i.qty || 0)), 0);
    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(30);
    });
    const salesValue = recentSales.reduce((sum, s) => sum + (s.total || 0), 0);
    if (costValue === 0) return 0;
    return (salesValue / costValue) * 12;
  }

  generateInsights(): Insight[] {
    const insights: Insight[] = [];
    const deadStock = this.getDeadStock();
    const reorderAlerts = this.getReorderAlerts();
    const overstock = this.getOverstock();
    const imeiAging = this.getIMEIAging();

    if (deadStock.length > 0) {
      const totalValue = deadStock.reduce((sum, i) => sum + ((i.price || 0) * (i.qty || 0)), 0);
      insights.push({
        id: 'inventory-dead-stock',
        category: 'inventory',
        severity: 'critical',
        title: `${deadStock.length} Dead Stock Items`,
        titleEs: `${deadStock.length} Artículos de Stock Muerto`,
        description: `Items with no sales in ${this.thresholds.deadStockDays}+ days. Consider clearance pricing.`,
        descriptionEs: `Artículos sin ventas en ${this.thresholds.deadStockDays}+ días. Considera precios de liquidación.`,
        metric: totalValue,
        metricLabel: this.lang === 'es' ? 'Valor en stock' : 'Stock Value',
        actionLabel: this.lang === 'es' ? 'Ver Inventario' : 'View Inventory',
        actionRoute: 'inventory',
        confidence: 0.95,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        data: { items: deadStock.map(i => ({ id: i.id, name: i.name, qty: i.qty })) },
      });
    }

    if (reorderAlerts.length > 0) {
      const mostUrgent = reorderAlerts[0];
      insights.push({
        id: 'inventory-reorder',
        category: 'inventory',
        severity: 'warning',
        title: 'Low Stock Alert',
        titleEs: 'Alerta de Stock Bajo',
        description: `${mostUrgent.item.name} has only ${Math.round(mostUrgent.daysLeft)} days of supply.`,
        descriptionEs: `${mostUrgent.item.name} solo tiene ${Math.round(mostUrgent.daysLeft)} días de inventario.`,
        metric: mostUrgent.item.qty || 0,
        metricLabel: this.lang === 'es' ? 'Unidades restantes' : 'Units remaining',
        actionLabel: this.lang === 'es' ? 'Ver Inventario' : 'View Inventory',
        actionRoute: 'inventory',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        data: { items: reorderAlerts.slice(0, 5).map(r => ({ name: r.item.name, daysLeft: Math.round(r.daysLeft) })) },
      });
    }

    if (overstock.length > 0) {
      insights.push({
        id: 'inventory-overstock',
        category: 'inventory',
        severity: 'info',
        title: 'Overstock Items Detected',
        titleEs: 'Artículos Excedidos Detectados',
        description: `${overstock.length} items have more than ${this.thresholds.overstockDays} days of supply.`,
        descriptionEs: `${overstock.length} artículos tienen más de ${this.thresholds.overstockDays} días de inventario.`,
        metric: overstock.length,
        metricLabel: this.lang === 'es' ? 'Artículos excedidos' : 'Overstock items',
        confidence: 0.85,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
    }

    // R-INTEL-SMARTER-F2: early-warning "dying stock" insight — items
    // with velocityScore < 0.1 but some sales (else they'd already be
    // flagged as fully dead). Gives the owner time to act before the
    // item crosses into hard dead-stock threshold.
    const velocityData = this.getDeadStockByVelocity(90);
    const dying = velocityData.filter(
      v => v.velocityScore > 0 && v.velocityScore < 0.1 && v.salesLastWindow > 0,
    );
    if (dying.length > 0) {
      const dyingValue = dying.reduce(
        (s, v) => s + ((v.item.price || 0) * (v.item.qty || 0)),
        0,
      );
      const top = dying.slice(0, 3).map(v => v.item.name).join(', ');
      insights.push({
        id: 'inventory-dying-stock',
        category: 'inventory',
        severity: 'warning',
        title: 'Items Losing Momentum',
        titleEs: 'Artículos Perdiendo Velocidad',
        description: `${dying.length} items with velocity <10% of peak SKU. Consider promo before they go dead. Top: ${top}.`,
        descriptionEs: `${dying.length} artículos con velocidad <10% del SKU top. Considera promoción antes de que caigan muertos. Top: ${top}.`,
        metric: dyingValue,
        metricLabel: this.lang === 'es' ? 'Valor en riesgo' : 'At-risk value',
        actionLabel: this.lang === 'es' ? 'Ver Inventario' : 'View Inventory',
        actionRoute: 'inventory',
        confidence: 0.85,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        data: {
          items: dying.slice(0, 10).map(v => ({
            id: v.item.id,
            name: v.item.name,
            velocity: Math.round(v.velocityScore * 100) / 100,
            daysSinceLastSale: v.daysSinceLastSale,
            salesLastWindow: v.salesLastWindow,
          })),
        },
      });
    }

    if (imeiAging.length > 0) {
      insights.push({
        id: 'inventory-imei-aging',
        category: 'inventory',
        severity: 'warning',
        title: 'Aging Phone Inventory',
        titleEs: 'Inventario de Teléfonos Envejecido',
        description: `${imeiAging.length} phones unsold for ${this.thresholds.agingThresholdDays}+ days.`,
        descriptionEs: `${imeiAging.length} teléfonos sin vender por ${this.thresholds.agingThresholdDays}+ días.`,
        metric: imeiAging.length,
        metricLabel: this.lang === 'es' ? 'Teléfonos envejecidos' : 'Aging phones',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    return insights;
  }
}