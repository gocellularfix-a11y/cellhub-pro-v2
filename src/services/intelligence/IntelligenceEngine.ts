// CellHub Intelligence — Intelligence Engine Orchestrator
import type { Sale, Customer, InventoryItem, Repair } from '@/store/types';
import type { Insight, IntelligenceReport, StoreHealthScore, KPIDashboard, AnalysisWindow } from './types';

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

export interface EngineConfig {
  storeId?: string;
  lang: 'en' | 'es';
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

export class IntelligenceEngine {
  private sales: Sale[];
  private customers: Customer[];
  private inventory: InventoryItem[];
  private repairs: Repair[];
  private config: EngineConfig;

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
    config: Partial<EngineConfig> = {}
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

    const allInsights: Insight[] = [
      ...salesInsights,
      ...inventoryInsights,
      ...repairInsights,
      ...customerInsights,
      ...financialInsights,
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

    const factors: string[] = [];
    if (salesTrend.trend === 'up') factors.push('Revenue trending up');
    if (deadStock.length > 0) factors.push(`${deadStock.length} dead stock items`);
    if (reorderAlerts.length > 0) factors.push(`${reorderAlerts.length} reorder alerts`);
    if (overdueRepairs.length > 0) factors.push(`${overdueRepairs.length} overdue repairs`);
    if (atRiskCustomers.length > 0) factors.push(`${atRiskCustomers.length} at-risk customers`);

    const title = this.config.lang === 'es' ? 'Salud de la Tienda' : 'Store Health';
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
}