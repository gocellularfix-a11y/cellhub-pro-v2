// CellHub Intelligence — Intelligence Engine Orchestrator
import type { Sale, Customer, InventoryItem, Repair, SpecialOrder, Unlock, Layaway, CustomerReturn } from '@/store/types';
import type { Insight, IntelligenceReport, StoreHealthScore, KPIDashboard, AnalysisWindow, CustomerHistorySummary } from './types';
import { computeCustomerProfit } from '@/utils/customerProfit';

import { SalesAnalyzer } from './analyzers/SalesAnalyzer';
import { InventoryAnalyzer } from './analyzers/InventoryAnalyzer';
import { RepairAnalyzer } from './analyzers/RepairAnalyzer';
import { CustomerAnalyzer } from './analyzers/CustomerAnalyzer';
import { FinancialAnalyzer } from './analyzers/FinancialAnalyzer';

import { AlertEngine } from './alerts/AlertEngine';
import { DEFAULT_THRESHOLDS } from './alerts/thresholds';
import type { Alert } from './alerts/AlertTypes';

import { CustomerScorer } from './scoring/CustomerScorer';
import { InventoryScorer } from './scoring/InventoryScorer';
import { RepairScorer } from './scoring/RepairScorer';

import type { CustomerScore } from './scoring/CustomerScorer';
import type { InventoryScore } from './scoring/InventoryScorer';
import type { RepairScore } from './scoring/RepairScorer';

import { getDaysAgo } from './utils/dateHelpers';
import { adaptSale, adaptCustomer, adaptInventory, adaptRepair } from './adapters/schemaAdapter';
import { findRepairInventoryGaps, type RepairInventoryGap } from './correlations';

export interface EngineConfig {
  storeId?: string;
  lang: 'en' | 'es' | 'pt';
  thresholds?: typeof DEFAULT_THRESHOLDS;
  enableAlerts: boolean;
  enableScoring: boolean;
  cacheTimeoutMinutes: number;
}

export interface EngineResult {
  report: IntelligenceReport;
  insights: Insight[];
  alerts: Alert[];
  kpiDashboard: KPIDashboard;
  healthScore: StoreHealthScore;
  customerScores: CustomerScore[];
  inventoryScores: InventoryScore[];
  repairScores: RepairScore[];
  generatedAt: Date;
}

const DEFAULT_CONFIG: EngineConfig = {
  lang: 'en',
  enableAlerts: true,
  enableScoring: true,
  cacheTimeoutMinutes: 15,
};

// Optional extras for features that cross the analyzer boundary
// (e.g. per-customer rollups that need SpecialOrders/Unlocks/Layaways/Returns).
// All default to [] so existing callers don't need changes.
export interface EngineExtras {
  specialOrders?: SpecialOrder[];
  unlocks?: Unlock[];
  layaways?: Layaway[];
  customerReturns?: CustomerReturn[];
}

export class IntelligenceEngine {
  private sales: Sale[];
  private customers: Customer[];
  private inventory: InventoryItem[];
  private repairs: Repair[];
  private config: EngineConfig;

  // R-INTEL-CUSTOMER-HISTORY: raw extras (no schema adapter) for
  // per-customer rollups. These modules don't feed the main analyzers
  // so they skip the adapter pipeline.
  private specialOrders: SpecialOrder[];
  private unlocks: Unlock[];
  private layaways: Layaway[];
  private customerReturns: CustomerReturn[];

  private salesAnalyzer: SalesAnalyzer;
  private inventoryAnalyzer: InventoryAnalyzer;
  private repairAnalyzer: RepairAnalyzer;
  private customerAnalyzer: CustomerAnalyzer;
  private financialAnalyzer: FinancialAnalyzer;

  private alertEngine: AlertEngine;
  private customerScorer: CustomerScorer;
  private inventoryScorer: InventoryScorer;
  private repairScorer: RepairScorer;

  private cachedResult?: EngineResult;
  private lastRun?: Date;

  constructor(
    sales: Sale[],
    customers: Customer[],
    inventory: InventoryItem[],
    repairs: Repair[],
    config: Partial<EngineConfig> = {},
    extras: EngineExtras = {}
  ) {
    // Schema Adapter: normalize legacy/mixed production data to canonical v2
    // schema expected by the analyzers. See adapters/schemaAdapter.ts for
    // details. Remove adapter calls once data is fully migrated.
    //
    // Order matters: adapt inventory FIRST so we can pass it to adaptSale,
    // which uses it to enrich legacy sale items (no inventoryId/itemId) via
    // normalized name match.
    this.inventory = adaptInventory(inventory as unknown as unknown[]);
    this.sales = adaptSale(sales as unknown as unknown[], this.inventory);
    this.customers = adaptCustomer(customers as unknown as unknown[]);
    this.repairs = adaptRepair(repairs as unknown as unknown[]);
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.specialOrders = extras.specialOrders ?? [];
    this.unlocks = extras.unlocks ?? [];
    this.layaways = extras.layaways ?? [];
    this.customerReturns = extras.customerReturns ?? [];

    this.salesAnalyzer = new SalesAnalyzer(
      this.sales,
      this.customers,
      this.config.storeId,
      this.config.lang
    );
    this.inventoryAnalyzer = new InventoryAnalyzer(
      this.inventory,
      this.sales,
      undefined,
      this.config.lang
    );
    this.repairAnalyzer = new RepairAnalyzer(this.repairs, this.config.storeId, this.config.lang);
    this.customerAnalyzer = new CustomerAnalyzer(
      this.customers,
      this.sales,
      this.config.storeId,
      this.config.lang
    );
    this.financialAnalyzer = new FinancialAnalyzer(
      this.sales,
      this.repairs,
      [],
      this.config.storeId,
      this.config.lang
    );

    this.alertEngine = new AlertEngine(
      this.config.thresholds || DEFAULT_THRESHOLDS,
      this.config.lang,
      this.config.storeId
    );
    this.customerScorer = new CustomerScorer(
      this.customers,
      this.sales,
      this.config.storeId,
      this.config.lang
    );
    this.inventoryScorer = new InventoryScorer(
      this.inventory,
      this.sales,
      this.config.storeId,
      this.config.lang
    );
    this.repairScorer = new RepairScorer(
      this.repairs,
      this.config.storeId,
      this.config.lang
    );
  }

  analyze(window?: AnalysisWindow): EngineResult {
    const analysisWindow = window || {
      start: getDaysAgo(30),
      end: new Date(),
      label: 'Last 30 days',
    };

    const salesInsights = this.salesAnalyzer.generateInsights(analysisWindow);
    const inventoryInsights = this.inventoryAnalyzer.generateInsights();
    const repairInsights = this.repairAnalyzer.generateInsights(analysisWindow);
    const customerInsights = this.customerAnalyzer.generateInsights(analysisWindow);
    const financialInsights = this.financialAnalyzer.generateInsights(analysisWindow);

    // R-INTEL-CROSS-F3: cross-module correlation insights. Crosses the
    // repair ↔ inventory boundary so can't live in a single analyzer.
    const correlationInsights = this.generateCorrelationInsights();

    const allInsights: Insight[] = [
      ...salesInsights,
      ...inventoryInsights,
      ...repairInsights,
      ...customerInsights,
      ...financialInsights,
      ...correlationInsights,
    ].sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2, opportunity: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    const alerts: Alert[] = this.config.enableAlerts
      ? this.alertEngine.evaluate(this.sales, this.inventory, this.repairs, this.customers)
      : [];

    const customerScores = this.config.enableScoring
      ? this.customerScorer.scoreAll()
      : [];
    const inventoryScores = this.config.enableScoring
      ? this.inventoryScorer.scoreAll()
      : [];
    const repairScores = this.config.enableScoring
      ? this.repairScorer.scoreAll()
      : [];

    const report = this.generateReport(analysisWindow, allInsights);
    const kpiDashboard = this.generateKPIDashboard(analysisWindow);
    const healthScore = this.calculateHealthScore();

    this.cachedResult = {
      report,
      insights: allInsights,
      alerts,
      kpiDashboard,
      healthScore,
      customerScores,
      inventoryScores,
      repairScores,
      generatedAt: new Date(),
    };
    this.lastRun = new Date();

    return this.cachedResult;
  }

  private generateReport(window: AnalysisWindow, insights: Insight[]): IntelligenceReport {
    const salesMetrics = this.salesAnalyzer.getMetrics(window);
    const inventoryMetrics = this.inventoryAnalyzer.getMetrics();
    const repairMetrics = this.repairAnalyzer.getMetrics(window);
    const customerMetrics = this.customerAnalyzer.getMetrics(window);
    const financialMetrics = this.financialAnalyzer.getMetrics(window);

    return {
      id: `report-${Date.now()}`,
      storeId: this.config.storeId,
      window,
      sales: salesMetrics,
      inventory: inventoryMetrics,
      repairs: repairMetrics,
      customers: customerMetrics,
      financial: financialMetrics,
      insights,
      generatedAt: new Date(),
    };
  }

  private generateKPIDashboard(window: AnalysisWindow): KPIDashboard {
    const salesMetrics = this.salesAnalyzer.getMetrics(window);
    const inventoryMetrics = this.inventoryAnalyzer.getMetrics();
    const repairMetrics = this.repairAnalyzer.getMetrics(window);
    const customerMetrics = this.customerAnalyzer.getMetrics(window);

    const topItems = this.salesAnalyzer.getBestSellingItems(5);
    const slowDays = this.salesAnalyzer.getSlowestDays();
    const hourlyHeatmap = this.salesAnalyzer.getHourlyHeatmap();
    const trend = this.salesAnalyzer.getDailyRevenueTrend();

    return {
      storeId: this.config.storeId,
      period: window.label,
      startDate: window.start,
      endDate: window.end,
      revenue: {
        current: salesMetrics.totalRevenue,
        previous: 0,
        trend: trend.trend,
        trendPercent: trend.percent,
      },
      transactions: {
        count: salesMetrics.transactionCount,
        avgSize: salesMetrics.avgTransactionSize,
      },
      inventory: {
        totalValue: inventoryMetrics.totalValue,
        totalItems: inventoryMetrics.totalItems,
        lowStockCount: inventoryMetrics.reorderAlertCount,
        deadStockCount: inventoryMetrics.deadStockCount,
      },
      repairs: {
        pending: repairMetrics.totalCompleted,
        overdue: repairMetrics.overdueCount,
      },
      customers: {
        total: customerMetrics.totalCustomers,
        new: customerMetrics.newCustomers,
        returning: customerMetrics.returningCustomers,
      },
      topItems,
      slowDays,
      hourlyHeatmap,
    };
  }

  private calculateHealthScore(): StoreHealthScore {
    const salesTrend = this.salesAnalyzer.getDailyRevenueTrend();
    const deadStock = this.inventoryAnalyzer.getDeadStock();
    const reorderAlerts = this.inventoryAnalyzer.getReorderAlerts();
    const overdueRepairs = this.repairAnalyzer.generateInsights().filter(
      i => i.id === 'repair-overdue'
    );
    const atRiskCustomers = this.customerAnalyzer.getAtRiskCustomers();

    let score = 100;

    if (salesTrend.trend === 'down') score -= Math.min(Math.abs(salesTrend.percent), 20);
    else if (salesTrend.trend === 'up') score += Math.min(salesTrend.percent, 10);

    score -= deadStock.length * 2;
    score -= reorderAlerts.length * 1;
    score -= overdueRepairs.length * 3;
    score -= Math.min(atRiskCustomers.length, 10);

    score = Math.max(0, Math.min(100, score));

    let grade: StoreHealthScore['grade'];
    if (score >= 90) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    const lang = this.config.lang;
    const factors: string[] = [];
    if (salesTrend.trend === 'up') factors.push(lang === 'es' ? 'Ingresos en aumento' : lang === 'pt' ? 'Receita em alta' : 'Revenue trending up');
    if (deadStock.length > 0) factors.push(lang === 'es' ? `${deadStock.length} artículos sin movimiento` : lang === 'pt' ? `${deadStock.length} itens sem giro` : `${deadStock.length} dead stock items`);
    if (reorderAlerts.length > 0) factors.push(lang === 'es' ? `${reorderAlerts.length} alertas de reorden` : lang === 'pt' ? `${reorderAlerts.length} alertas de reposição` : `${reorderAlerts.length} reorder alerts`);
    if (overdueRepairs.length > 0) factors.push(lang === 'es' ? `${overdueRepairs.length} reparaciones vencidas` : lang === 'pt' ? `${overdueRepairs.length} reparos em atraso` : `${overdueRepairs.length} overdue repairs`);
    if (atRiskCustomers.length > 0) factors.push(lang === 'es' ? `${atRiskCustomers.length} clientes en riesgo` : lang === 'pt' ? `${atRiskCustomers.length} clientes em risco` : `${atRiskCustomers.length} at-risk customers`);

    const title = lang === 'es' ? 'Salud de la Tienda' : lang === 'pt' ? 'Saúde da Loja' : 'Store Health';
    const titleEs = 'Salud de la Tienda';

    return {
      score: Math.round(score),
      grade,
      factors,
      title,
      titleEs,
      generatedAt: new Date(),
    };
  }

  getInsights(category?: Insight['category']): Insight[] {
    if (!this.cachedResult) return [];
    if (category) {
      return this.cachedResult.insights.filter(i => i.category === category);
    }
    return this.cachedResult.insights;
  }

  getAlerts(): Alert[] {
    if (!this.cachedResult) return [];
    return this.cachedResult.alerts;
  }

  getCustomerScores(): CustomerScore[] {
    if (!this.cachedResult) return [];
    return this.cachedResult.customerScores;
  }

  getInventoryScores(): InventoryScore[] {
    if (!this.cachedResult) return [];
    return this.cachedResult.inventoryScores;
  }

  getRepairScores(): RepairScore[] {
    if (!this.cachedResult) return [];
    return this.cachedResult.repairScores;
  }

  getHealthScore(): StoreHealthScore | null {
    if (!this.cachedResult) return null;
    return this.cachedResult.healthScore;
  }

  refresh(): EngineResult {
    return this.analyze();
  }

  // R-INTEL-CROSS-F3: surface repair ↔ inventory gaps as insights.
  // Emits up to 3 opportunity insights for repair types where related
  // accessories are low-stocked → cross-sell opportunity.
  private generateCorrelationInsights(): Insight[] {
    const gaps = findRepairInventoryGaps(this.repairs, this.inventory, this.sales, 60, 5);
    const insights: Insight[] = [];
    const es = this.config.lang === 'es';

    for (const g of gaps.slice(0, 3)) {
      // Only emit if there's actual actionable data (low-stock related items).
      if (g.lowStockRelatedItems.length === 0) continue;

      const topModels = g.topDeviceModels.map(m => `${m.model} (${m.count})`).join(', ');
      const lowStock = g.lowStockRelatedItems.map(i => `${i.name} (${i.qty})`).slice(0, 3).join(', ');

      insights.push({
        id: `correlation-repair-${g.repairType}`,
        category: 'inventory',
        severity: 'opportunity',
        title: es
          ? `Oportunidad: accesorios de ${g.repairType}`
          : `Opportunity: ${g.repairType} accessories`,
        titleEs: `Oportunidad: accesorios de ${g.repairType}`,
        description: es
          ? `${g.recentRepairCount} reparaciones de ${g.repairType} recientes${topModels ? ` (top: ${topModels})` : ''}. Stock bajo en accesorios relacionados: ${lowStock}. Considera cross-sell.`
          : `${g.recentRepairCount} recent ${g.repairType} repairs${topModels ? ` (top: ${topModels})` : ''}. Low stock on related accessories: ${lowStock}. Consider cross-selling.`,
        descriptionEs: `${g.recentRepairCount} reparaciones de ${g.repairType} recientes${topModels ? ` (top: ${topModels})` : ''}. Stock bajo en accesorios relacionados: ${lowStock}. Considera cross-sell.`,
        metric: g.recentRepairCount,
        metricLabel: es ? 'Reparaciones recientes' : 'Recent repairs',
        actionLabel: es ? 'Ver Inventario' : 'View Inventory',
        actionRoute: 'inventory',
        confidence: g.confidence,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        data: { gap: g as unknown as Record<string, unknown> },
      });
    }

    return insights;
  }

  // Expose correlations directly for UI/chat consumers.
  getRepairInventoryGaps(): RepairInventoryGap[] {
    return findRepairInventoryGaps(this.repairs, this.inventory, this.sales, 60, 5);
  }

  // R-INTEL-CUSTOMER-HISTORY: per-customer rollup. Crosses analyzer
  // boundaries (combines sales/repairs/SOs/unlocks/layaways/returns)
  // so lives on the engine rather than in any single analyzer.
  //
  // Returns null if the customer isn't found. Callers should handle the
  // null case (e.g. disambiguate via fuzzy search before calling).
  getCustomerHistory(customerId: string): CustomerHistorySummary | null {
    const customer = this.customers.find(c => c.id === customerId);
    if (!customer) return null;

    const customerSales = this.sales.filter(s => s.customerId === customerId);

    // Returns linked by customerId (if stored) or via originalSaleId fallback.
    const saleIds = new Set(customerSales.map(s => s.id));
    const returnsForCustomer = this.customerReturns.filter((r) => {
      if ((r as { customerId?: string }).customerId === customerId) return true;
      return r.originalSaleId ? saleIds.has(r.originalSaleId) : false;
    });

    const stats = computeCustomerProfit(customerSales, returnsForCustomer);

    // First / last visit — min/max over non-voided sale timestamps.
    const times = customerSales
      .filter(s => s.status !== 'voided')
      .map(s => new Date(s.createdAt as string).getTime())
      .filter(t => !Number.isNaN(t))
      .sort((a, b) => a - b);
    const firstVisit = times.length > 0 ? new Date(times[0]) : null;
    const lastVisit = times.length > 0 ? new Date(times[times.length - 1]) : null;

    // Top items by revenue (top 5).
    const itemMap: Record<string, { quantity: number; revenue: number }> = {};
    for (const sale of customerSales) {
      if (sale.status === 'voided') continue;
      for (const item of sale.items || []) {
        const key = item.name || 'Unknown';
        itemMap[key] = {
          quantity: (itemMap[key]?.quantity || 0) + (item.qty || 0),
          revenue: (itemMap[key]?.revenue || 0) + ((item.price || 0) * (item.qty || 0)),
        };
      }
    }
    const topItems = Object.entries(itemMap)
      .map(([name, d]) => ({ name, quantity: d.quantity, revenue: d.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Preferred payment method — most frequent across non-voided sales.
    const paymentCount: Record<string, number> = {};
    for (const sale of customerSales) {
      if (sale.status === 'voided') continue;
      const pm = String(sale.paymentMethod || '').toLowerCase();
      if (!pm) continue;
      paymentCount[pm] = (paymentCount[pm] || 0) + 1;
    }
    const preferredPaymentMethod = Object.entries(paymentCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Linked entities — counts + active balance across all deposit modules.
    const customerRepairs = this.repairs.filter(r => r.customerId === customerId);
    const customerSOs = this.specialOrders.filter(o => o.customerId === customerId);
    const customerUnlocks = this.unlocks.filter(u => u.customerId === customerId);
    const customerLayaways = this.layaways.filter(l => l.customerId === customerId);

    const repairTotalValue = customerRepairs.reduce(
      (s, r) => s + (r.total || r.estimatedCost || 0),
      0,
    );
    const activeBalance =
      customerRepairs.reduce((s, r) => s + (r.balance || 0), 0) +
      customerSOs.reduce((s, o) => s + (o.balance || 0), 0) +
      customerUnlocks.reduce((s, u) => s + (u.balance || 0), 0) +
      customerLayaways.reduce((s, l) => s + (l.balance || 0), 0);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        customerNumber: (customer as { customerNumber?: string }).customerNumber,
        loyaltyPoints: customer.loyaltyPoints || 0,
        storeCredit: customer.storeCredit || 0,
        carrier: (customer as { carrier?: string }).carrier,
      },
      grossRevenue: stats.grossRevenue,
      netRevenue: stats.netRevenue,
      totalRefunded: stats.totalRefunded,
      profit: stats.profit,
      margin: stats.margin,
      avgTicket: stats.avgTicket,
      visitCount: stats.visitCount,
      avgDaysBetweenVisits: stats.avgDaysBetweenVisits,
      costCoverage: stats.costCoverage,
      topCategoryByProfit: stats.topCategoryByProfit as string | null,
      topCategoryProfit: stats.topCategoryProfit,
      firstVisit,
      lastVisit,
      topItems,
      preferredPaymentMethod,
      linkedEntities: {
        repairCount: customerRepairs.length,
        repairTotalValue,
        specialOrderCount: customerSOs.length,
        unlockCount: customerUnlocks.length,
        layawayCount: customerLayaways.length,
        activeBalance,
      },
    };
  }
}