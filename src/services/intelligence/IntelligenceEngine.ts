// CellHub Intelligence — Intelligence Engine Orchestrator
import type { Sale, Customer, InventoryItem, Repair, SpecialOrder, Unlock, Layaway, CustomerReturn, Expense, Employee, Appointment, StoreCreditLedger, StoreSettings } from '@/store/types';
// CELLHUB-INTELLIGENCE-I2A: canonical report-money adapter — financial
// calculations are owned by computeReportMoneyStats; the adapter and this
// engine only wire data and map fields.
import { computeCanonicalMoneyForRange, localDayRangeForDay, localDayRangeForWindow } from './adapters/reportMoneyAdapter';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
// I2B-1.1: the SAME inclusive local-day membership test the canonical service
// uses — auxiliary EOD filters must never re-derive day boundaries.
import { isWithinLocalDayRange } from '@/utils/reportRange';
import type { CanonicalMoneySnapshot, CanonicalMoneySettings } from './adapters/reportMoneyAdapter';
import type { Insight, IntelligenceReport, StoreHealthScore, KPIDashboard, AnalysisWindow, CustomerHistorySummary, MissedRevenueReport, NextVisitPrediction, ProductOpportunity, ReorderRecommendation, RootCauseReport, SlowDayRootCauseReport, DeadStockRootCauseReport, ChurnRootCauseReport, DailyBriefResult, ContextualBaseline, TrendDirectionReport } from './types';
import { computeContextualBaseline } from './baseline/contextualBaseline';
import { computeTrendDirectionReport } from './trends/trendDirection';
import { evaluateQueueAutoResolution } from './autoResolution/resolutionRules';
import { getQueue, autoResolveQueueItem } from './managerQueue/actions';
import {
  ensureOperationalWorkflow,
  autoCompleteWorkflow,
  type EnsureWorkflowParams,
  type OperationalWorkflow,
} from './workflows/flowEngine';
import { evaluatePendingOutcomes, type OutcomeEvalContext } from './outcomes/outcomeEngine';
import { generateProactiveOperationsReport, type ProactiveEvalContext } from './proactive/proactiveEngine';
import type { ProactiveOperationsReport } from './proactive/types';
import { generatePreparedExecutions, type ExecutionEvalContext } from './execution/executionEngine';
import type { ExecutionReport } from './execution/types';
import { generateMorningDigest, type DigestEvalContext } from './digest/morningDigest';
import type { MorningDigest } from './digest/types';
import { generateLiveAssistSuggestion, type LiveAssistEvalContext } from './live/liveOperatingAssistant';
import type { LiveAssistSuggestion, LiveAssistContext } from './live/types';
import { computeAttentionSnapshot } from './attention/attentionEngine';
import type { AttentionSnapshot } from './attention/types';
import { generateOperationalReasoningReport, type ReasoningEvalContext } from './reasoning/crossSystemEngine';
import type { OperationalReasoningReport } from './reasoning/types';
import { generateDecisionRecommendationReport, type DecisionEvalContext } from './decisions/decisionEngine';
import type { DecisionRecommendationReport } from './decisions/types';
import { diagnoseRevenueDecline } from './rootCause/revenueCauses';
import { diagnoseSlowDay } from './rootCause/slowDayCauses';
import { diagnoseDeadStock } from './rootCause/deadStockCauses';
import { diagnoseChurn } from './rootCause/churnCauses';
// CELLHUB-INTELLIGENCE-I2B-1: the legacy customerProfit pipeline
// (computeCustomerProfit + adjustSalesItemCosts) is no longer used by the
// engine — getTodayMoney now sources canonical money. The helper file remains
// only for its regression-lock test; ProfitAdjustmentSettings is referenced in
// prose comments below (profitSettings is typed CanonicalMoneySettings).
// I2B-0.1/0.2/2: canonical customer money (same service Customer 360 uses),
// fed with RAW snapshot collections via the canonical attribution helper.
// computeCustomerMoneyProfiles = the batched multi-customer profile used by
// the customer list; reused here so analyzer/chat customer-value rankings
// share ONE canonical source (no legacy sale.total reduce).
import {
  attributeCustomerCollections, computeProfileFromAttributed, computeCustomerMoneyProfiles,
} from '@/services/customers/customerMoneyProfile';
import type { CustomerMoneyProfile } from '@/services/customers/customerMoneyProfile';

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
// CELLHUB-INTELLIGENCE-I3-3: Business Analyst layer.
import { collectBusinessFindings } from './insights/findingsEngine';
import { buildInsightCards } from './insights/insightCards';
import { suggestQuestions } from './insights/suggestedQuestions';
import { resolveBusinessDateRange as resolveBusinessDateRangeForInsightsImpl } from './query/resolveBusinessDateRange';
import type { ResolvedBusinessDateRange } from './query/types';

// Named-range resolver for the insights API (kept tiny + typed).
function resolveBusinessDateRangeForInsights(
  kind: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days',
  referenceDate: Date,
): ResolvedBusinessDateRange {
  const resolved = kind === 'last_30_days'
    ? resolveBusinessDateRangeForInsightsImpl(undefined, referenceDate)
    : resolveBusinessDateRangeForInsightsImpl({ kind }, referenceDate);
  // Named kinds always resolve; the fallback default is last_30_days.
  return resolved ?? resolveBusinessDateRangeForInsightsImpl(undefined, referenceDate)!;
}
// R-INTEL-AUTO-ACTION-QUEUE-ARCH-FIX: refresh() is now side-effect-free.
// buildOutreachQueueItems() stays as a pure helper — chat handlers (only
// who_to_contact_today right now) call it explicitly and persist via
// enqueueOutreachActions in actions.ts.
import type { ActionQueueItem } from './types';

export interface EngineConfig {
  storeId?: string;
  lang: 'en' | 'es' | 'pt';
  thresholds?: typeof DEFAULT_THRESHOLDS;
  enableAlerts: boolean;
  enableScoring: boolean;
  cacheTimeoutMinutes: number;
  leadTimeDays?: number;  // R-INTEL-2-REORDER: days to receive stock (default 3)
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
  // R-DATA-EXPENSE-ACCESS-V1: raw expenses list. Read-only — engine never
  // computes net profit. Helpers in cellhubDataAccess summarize/filter.
  expenses?: Expense[];
  // R-DATA-EMPLOYEE-ACCESS-V1: roster pass-through. Engine reads only —
  // performance aggregation happens in cellhubDataAccess via sale.employeeName.
  employees?: Employee[];
  // R-DATA-APPOINTMENT-ACCESS-V1: read-only pass-through. Filtering/counting
  // happens in cellhubDataAccess using estimatedDropOff (ISO date-time).
  appointments?: Appointment[];
  // R-CUSTOMER-PROFIT-PARITY-V1: optional store settings used by
  // getCustomerHistory to translate phone_payment / repair / special_order
  // line items into their real economic cost (commission rate for
  // phone payments, 35% fallback for repair items missing parts cost).
  // Without this, customer-history profit double-counts the carrier
  // pass-through portion of phone payments — the bug Jorge spotted
  // where Juan's 4 Verizon payments showed 91% margin.
  // CELLHUB-INTELLIGENCE-I2A.1: widened to CanonicalMoneySettings (a
  // superset of ProfitAdjustmentSettings — same two commission fields plus
  // paymentPortals/carrierPortalUrls) so the canonical money service gets a
  // properly typed object with no double cast. Both real callers pass the
  // full GLOBAL state.settings; narrow test literals stay assignable.
  settings?: CanonicalMoneySettings;
  // R-INTEL-CROSS-001: store credit ledger — global (no storeId filter),
  // same contract as customers. Consumers call getStoreCreditLedger().
  storeCreditLedger?: StoreCreditLedger[];
  // CELLHUB-INTELLIGENCE-I2A: vendor returns pass-through — required by the
  // canonical report-money service (they reduce COGS). Read-only.
  vendorReturns?: unknown[];
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
  // R-DATA-EXPENSE-ACCESS-V1
  private expenses: Expense[];
  // R-DATA-EMPLOYEE-ACCESS-V1
  private employees: Employee[];
  // R-DATA-APPOINTMENT-ACCESS-V1
  private appointments: Appointment[];
  // R-INTEL-CROSS-001: global ledger — no storeId filter (certs belong to
  // customers, not stores; same scope contract as customers).
  private storeCreditLedger: StoreCreditLedger[];
  // CELLHUB-INTELLIGENCE-I2A: vendor returns (COGS reduction in the
  // canonical money service). Raw pass-through, read-only.
  private vendorReturns: unknown[];
  // R-CUSTOMER-PROFIT-PARITY-V1 → I2A.1: store settings for per-customer
  // profit adjustment AND the canonical money snapshot. Typed as the
  // explicit CanonicalMoneySettings contract (assignable wherever
  // ProfitAdjustmentSettings is accepted).
  private profitSettings: CanonicalMoneySettings;

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

  // R-OPERATOR-WHATSAPP-PERFORMANCE-ARCHITECTURE-AUDIT-V1: per-getter caches
  // for the three engine methods that bypass the analyze() result cache.
  // Both the IntelligenceModule (refresh memos) and chat handlers
  // (handleQuickProfit, handleProductOpportunities, etc.) call these
  // independently — without caching, the same scan ran multiple times per
  // refresh + per chat query. Invalidated alongside cachedResult in
  // updateData() and invalidateCache().
  private cachedReorderRecs?: ReorderRecommendation[];
  private cachedMissedRev?: MissedRevenueReport;
  private cachedProductOpps?: Map<number, ProductOpportunity[]>;
  // R-INTELLIGENCE-CONTEXTUAL-BASELINE-ENGINE-V1: store-aware baseline cache.
  private cachedBaseline?: ContextualBaseline;
  // R-INTELLIGENCE-TREND-DIRECTION-V1: trend direction report cache.
  private cachedTrendReport?: TrendDirectionReport;
  // R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: proactive report cache.
  private cachedProactiveReport?: ProactiveOperationsReport;
  // R-INTELLIGENCE-AUTOMATED-EXECUTION-V1: execution preparation report cache.
  private cachedExecutionReport?: ExecutionReport;
  // R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1: morning digest cache.
  private cachedMorningDigest?: MorningDigest;
  // R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1: cross-system operational reasoning cache.
  private cachedReasoningReport?: OperationalReasoningReport;
  // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: strategic decision recommendation cache.
  private cachedDecisionReport?: DecisionRecommendationReport;

  // R-INTEL-CUSTOMER-INDEX-V1: per-customer history cache. Without this,
  // `buildOutreachQueueItems` calls `getCustomerHistory(cs.customerId)` for
  // every scored customer, and `getCustomerHistory` itself scans 6 collections
  // per call (sales, repairs, SOs, unlocks, layaways, customerReturns) — total
  // O(C × Σ collections). Same pattern in `runProductPush`. The cache means
  // each customer's rollup is computed at most once per data snapshot,
  // collapsing cost to O(C + Σ) for the first pass and O(C) for re-asks.
  // Invalidated alongside cachedResult in updateData() and invalidateCache().
  private cachedCustomerHistory?: Map<string, CustomerHistorySummary | null>;
  // I2B-2: canonical per-customer money profiles (batched), memoized per data
  // snapshot and invalidated by updateData(). One source for the customer
  // list, the CustomerAnalyzer financial methods and the chat top-customers.
  private cachedCustomerValueProfiles?: Map<string, CustomerMoneyProfile>;

  // R-PERF-INTELLIGENCE-CACHE: raw input references kept so updateData()
  // can ref-equality-skip when nothing changed across React re-renders.
  // Adapted versions live in this.sales/customers/inventory/repairs above.
  private _rawSales: Sale[] = [];
  private _rawCustomers: Customer[] = [];
  private _rawInventory: InventoryItem[] = [];
  private _rawRepairs: Repair[] = [];
  private _rawSpecialOrders: SpecialOrder[] = [];
  private _rawUnlocks: Unlock[] = [];
  private _rawLayaways: Layaway[] = [];
  private _rawCustomerReturns: CustomerReturn[] = [];
  // R-DATA-EXPENSE-ACCESS-V1
  private _rawExpenses: Expense[] = [];
  // R-DATA-EMPLOYEE-ACCESS-V1
  private _rawEmployees: Employee[] = [];
  // R-DATA-APPOINTMENT-ACCESS-V1
  private _rawAppointments: Appointment[] = [];
  // R-INTEL-CROSS-001
  private _rawStoreCreditLedger: StoreCreditLedger[] = [];

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
    this.expenses = extras.expenses ?? [];
    this.employees = extras.employees ?? [];
    this.appointments = extras.appointments ?? [];
    this.storeCreditLedger = extras.storeCreditLedger ?? [];
    // CELLHUB-INTELLIGENCE-I2A: vendor returns for the canonical money service.
    this.vendorReturns = extras.vendorReturns ?? [];
    // R-CUSTOMER-PROFIT-PARITY-V1: empty {} when omitted ⇒ adjustSalesItemCosts
    // falls back to defaultRate=0 (no profit fabricated; just clears the
    // 100% margin bug for items where the stamped commissionRate is missing).
    this.profitSettings = extras.settings ?? {};

    // R-PERF-INTELLIGENCE-CACHE: snapshot raw input refs for updateData()
    // ref-equality skip. Stored AFTER extras defaults so the same defaults
    // are reused if updateData omits one (extras?.specialOrders ?? this.x).
    this._rawSales = sales;
    this._rawCustomers = customers;
    this._rawInventory = inventory;
    this._rawRepairs = repairs;
    this._rawSpecialOrders = this.specialOrders;
    this._rawUnlocks = this.unlocks;
    this._rawLayaways = this.layaways;
    this._rawCustomerReturns = this.customerReturns;
    this._rawExpenses = this.expenses;
    this._rawEmployees = this.employees;
    this._rawAppointments = this.appointments;
    this._rawStoreCreditLedger = this.storeCreditLedger;

    this.salesAnalyzer = new SalesAnalyzer(
      this.sales,
      this.customers,
      this.config.storeId,
      this.config.lang,
      // I2B-2.1: canonical range provider — authoritative money from canonical.
      (window) => this.getCanonicalMoneyForWindow(window),
    );
    this.inventoryAnalyzer = new InventoryAnalyzer(
      this.inventory,
      this.sales,
      undefined,
      this.config.lang
    );
    this.repairAnalyzer = new RepairAnalyzer(this.repairs, this.config.storeId, this.config.lang);
    // R-INTELLIGENCE-BEST-CUSTOMER-DATA-BUG-EXTEND: customers are
    // GLOBAL per AppProvider's filteredState contract — see detailed
    // note above the CustomerScorer instantiation. Same pattern,
    // same reasoning: CustomerAnalyzer.filterByStore would silently
    // wipe the entire customer set when storeId is set.
    this.customerAnalyzer = new CustomerAnalyzer(
      this.customers,
      this.sales,
      undefined,
      this.config.lang,
      // I2B-2: canonical customer-money source (lazy, memoized on the engine).
      () => this.getCustomerValueProfiles(),
    );
    this.financialAnalyzer = new FinancialAnalyzer(
      this.sales,
      this.repairs,
      [],
      this.config.storeId,
      this.config.lang,
      // I2B-2.1: canonical range provider — authoritative money from canonical.
      (window) => this.getCanonicalMoneyForWindow(window),
    );

    this.alertEngine = new AlertEngine(
      this.config.thresholds || DEFAULT_THRESHOLDS,
      this.config.lang,
      this.config.storeId
    );
    // R-INTELLIGENCE-BEST-CUSTOMER-DATA-BUG: customers are GLOBAL per
    // AppProvider's filteredState contract (see AppProvider.tsx:221 —
    // "Customers, employees, cart, and settings are GLOBAL (never
    // filtered)"). Customer records do NOT carry a storeId, so passing
    // this.config.storeId here causes CustomerScorer.filterByStore (strict
    // equality) to wipe the entire customer set → handleBestCustomer
    // returns "No customer data available yet." while engine.getCustomers()
    // (used by Customer 360 / customer_history) returns the same records
    // unfiltered. Sales attached to scoring are already store-filtered
    // upstream via filteredState, so dropping storeId here only affects
    // the customer-set filter, not the sales-per-customer index.
    this.customerScorer = new CustomerScorer(
      this.customers,
      this.sales,
      undefined,
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

  // R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1 — tiny passthrough so external
  // callers (Companion intelligence ack receiver) can mark an alert
  // acknowledged without reaching into the private alertEngine field. Pure
  // delegation; cero scoring touches, cero engine state beyond what
  // AlertEngine.acknowledge already mutates. Safe no-op when the engine
  // hasn't fired this alertId yet (AlertEngine.acknowledge does a find()).
  acknowledgeAlert(alertId: string, userId: string): void {
    this.alertEngine.acknowledge(alertId, userId);
  }

  analyze(window?: AnalysisWindow): EngineResult {
    // R-PERF-INTELLIGENCE-CACHE: 60-second result cache so back-to-back
    // analyze() calls (chat handlers each call engine.refresh() → analyze()
    // → 9 chat queries per session) reuse the prior pass instead of redoing
    // the full analyzers + scorers + alert engine work. Cache is invalidated
    // by updateData() when input refs change; window-scoped queries skip
    // the cache because the cached result is anchored to the default window.
    if (
      !window
      && this.cachedResult
      && this.lastRun
      && (Date.now() - this.lastRun.getTime()) < 60_000
    ) {
      return this.cachedResult;
    }
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
        pending: repairMetrics.totalActive,
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

  // R-INTELLIGENCE-REMOVE-DUPLICATE-CUSTOMER-SCORER-V1: returns legacy CustomerScore[]
  // from CustomerScorer (deprecated). Tier names are platinum|gold|silver|bronze|standard.
  // Future: replace with customerScoringEngine output (VIP|Loyal|Active|Casual|At Risk|Lost).
  // See scoring/tierAdapter.ts for the deterministic equivalence map.
  // Do NOT add new callers reading legacy tier names — migrate to CustomerBusinessProfile.
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

  // R-INTEL-CELLHUB-DATA-ACCESS-LAYER: read-only getters so the chat
  // data_query handler can route to cellhubDataAccess functions without
  // accessing private fields. Returns the engine's adapted arrays
  // (post-schemaAdapter normalization). Caller MUST treat as read-only.
  getSales(): Sale[] { return this.sales; }
  getInventory(): InventoryItem[] { return this.inventory; }
  getCustomers(): Customer[] { return this.customers; }
  getRepairs(): Repair[] { return this.repairs; }
  getUnlocks(): Unlock[] { return this.unlocks; }
  getLayaways(): Layaway[] { return this.layaways; }
  getSpecialOrders(): SpecialOrder[] { return this.specialOrders; }
  getReturns(): CustomerReturn[] { return this.customerReturns; }
  // R-DATA-EXPENSE-ACCESS-V1
  getExpenses(): Expense[] { return this.expenses; }
  // R-DATA-EMPLOYEE-ACCESS-V1
  getEmployees(): Employee[] { return this.employees; }
  // R-DATA-APPOINTMENT-ACCESS-V1
  getAppointments(): Appointment[] { return this.appointments; }
  // R-INTEL-CROSS-001: global ledger — no storeId filter, same contract as getCustomers().
  getStoreCreditLedger(): StoreCreditLedger[] { return this.storeCreditLedger; }

  // CELLHUB-INTELLIGENCE-I2A: today-only metrics for the chat's today
  // intents. Financial calculations are owned by computeReportMoneyStats —
  // this method performs data wiring and field mapping ONLY (see
  // adapters/reportMoneyAdapter.ts). The previous parallel implementation
  // (midnight-forward filter + reduce over sale.total + local top-seller
  // aggregation) was removed; Reports and Intelligence can no longer drift.
  //
  // Field mapping (old meaning → canonical):
  //   revenueCents   ("sales today" in chat)  → netSalesCents
  //     Old value ≈ countable-sale totals (gross w/o refunded originals,
  //     refund-audit rows subtracting inline). Canonical NET sales is the
  //     honest number for the same user-facing label.
  //   transactions   → txCount (gross activity: incl. later-refunded
  //     originals, excl. refund-representation rows).
  //   avgTicketCents → derived display ratio netSales/txCount (presentation
  //     only — not a canonical money policy).
  //   topSeller      → topItems[0] when its revenue is positive (canonical
  //     gross-activity item table; old positive-only contract preserved).
  // Additive canonical fields are exposed for future handlers; NO profit
  // numbers here (this DTO feeds ungated chat paths — profit stays in the
  // gated EOD pipeline).
  getTodayMetrics(): {
    revenueCents: number;
    transactions: number;
    avgTicketCents: number;
    topSeller: { name: string; revenueCents: number } | null;
    // I2A additive canonical fields:
    grossSalesCents: number;
    netSalesCents: number;
    returnsCents: number;
    netTaxCents: number;
    voidedCount: number;
    refundedCount: number;
    profitMarginMeaningful: boolean;
    profitAdjustmentEstimated: boolean;
  } {
    const stats = computeCanonicalMoneyForRange(
      this.canonicalMoneySnapshot(),
      localDayRangeForDay(new Date()),
    );
    const transactions = stats.txCount;
    const revenueCents = stats.netSalesCents;
    // Display ratio only — no rounding/clamp policy beyond integer cents.
    const avgTicketCents = transactions > 0 ? Math.round(revenueCents / transactions) : 0;
    const top = stats.topItems[0];
    const topSeller = top && top.revenueCents > 0
      ? { name: top.name, revenueCents: top.revenueCents }
      : null;
    return {
      revenueCents,
      transactions,
      avgTicketCents,
      topSeller,
      grossSalesCents: stats.grossSalesCents,
      netSalesCents: stats.netSalesCents,
      returnsCents: stats.returnAndRefundAdjustmentsCents,
      netTaxCents: stats.netTaxCents,
      voidedCount: stats.voidedCount,
      refundedCount: stats.refundedCount,
      profitMarginMeaningful: stats.profitMarginMeaningful,
      profitAdjustmentEstimated: stats.profitAdjustmentEstimated,
    };
  }

  // CELLHUB-INTELLIGENCE-I2A: the RAW store snapshot for the canonical
  // money service — the SAME un-adapted collections Reports reads (the
  // schema-adapted this.sales would break parity). Data wiring only.
  canonicalMoneySnapshot(): CanonicalMoneySnapshot {
    return {
      sales: this._rawSales,
      repairs: this._rawRepairs,
      unlocks: this._rawUnlocks,
      specialOrders: this._rawSpecialOrders,
      layaways: this._rawLayaways,
      inventory: this._rawInventory,
      customerReturns: this._rawCustomerReturns,
      vendorReturns: this.vendorReturns,
      // I2A.1: properly typed — CanonicalMoneySettings is the documented
      // contract of every settings field the canonical service reads. The
      // single type boundary lives in the adapter.
      settings: this.profitSettings,
    };
  }

  // CELLHUB-INTELLIGENCE-I2B-2.1: THE canonical money projection for an
  // arbitrary analyzer window. The single range provider injected into the
  // Financial + Sales analyzers so their authoritative money fields come from
  // computeReportMoneyStats — never a manual reduce. Day-granular (Reports
  // ranges are day-granular). Financial math is owned by the canonical
  // service; this is data wiring only.
  getCanonicalMoneyForWindow(window: { start: Date; end: Date }): ReportMoneyStats {
    return computeCanonicalMoneyForRange(this.canonicalMoneySnapshot(), localDayRangeForWindow(window));
  }

  // CELLHUB-INTELLIGENCE-I3-2: READ-ONLY execution context for the structured
  // business-query executor. Exposes canonical projections (full + scoped),
  // the batched canonical customer profiles, and the store-scoped raw data
  // needed for exact entity SCOPING — no mutation methods, no private-field
  // tricks. Financial math stays owned by computeReportMoneyStats.
  getStructuredQueryContext(referenceDate?: Date): import('./query/types').StructuredQueryContext {
    const snapshot = this.canonicalMoneySnapshot();
    return {
      snapshot,
      computeForRange: (range) => computeCanonicalMoneyForRange(snapshot, range),
      computeForScopedSnapshot: (partial, range) =>
        computeCanonicalMoneyForRange({ ...snapshot, ...partial }, range),
      getCustomerValueProfiles: () => this.getCustomerValueProfiles(),
      getTopCustomersByValue: (limit) => this.getTopCustomersByValue(limit),
      getCustomerHistory: (id) => this.getCustomerHistory(id),
      customers: this.customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      employees: this.employees.map((e) => ({ id: e.id, name: e.name })),
      storeId: this.config.storeId,
      referenceDate: referenceDate ?? new Date(),
    };
  }

  // CELLHUB-INTELLIGENCE-I3-3: Business Analyst API — deterministic findings,
  // typed cards and suggested questions over ONE canonical range (default:
  // the product's last_30_days). Read-only; all money via canonical
  // projections inside the insights modules. API only — no UI here.
  getBusinessInsights(
    referenceDate?: Date,
    rangeKind: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days' = 'last_30_days',
  ): import('./insights/types').BusinessInsightsResult {
    const ctx = this.getStructuredQueryContext(referenceDate);
    const range = resolveBusinessDateRangeForInsights(rangeKind, ctx.referenceDate);
    const findings = collectBusinessFindings(ctx, range);
    return {
      findings,
      cards: buildInsightCards(ctx, range, findings),
      suggestions: suggestQuestions(findings, this.config.lang),
      generatedForRange: { startYMD: range.startYMD, endYMD: range.endYMD },
    };
  }

  // CELLHUB-INTELLIGENCE-I2B-1: today-only money for the End-of-Day brief,
  // sourced from THE canonical report service (computeReportMoneyStats) — the
  // same pipeline Reports / Customer 360 / chat consume. getTodayMoney no
  // longer runs the legacy adjustSalesItemCosts + computeCustomerProfit
  // approximation: core money (gross / net / profit / margin / returns / cost /
  // tax / tender / txCount / flags) is CANONICAL, computed over the RAW scoped
  // snapshot for the LOCAL calendar day. EOD money === Reports money.
  //
  // The A2A tender/fees breakdown is display plumbing, NOT profit math. Cash /
  // card / storeCredit and the tax/fee buckets now also come from canonical;
  // only the two fields canonical does not model — otherCents (unknown/legacy
  // payment methods) and creditCardFeeCents — are summed from the raw
  // day-scoped active sales. No tax/profit/refund formula is reproduced here.
  // externalCents stays 0. Negative values are preserved (never clamped).
  // All values are integer cents; profitMarginPct is a 0–100 percentage.
  getTodayMoney(): {
    grossRevenueCents: number;
    netRevenueCents: number;
    grossProfitCents: number;
    profitMarginPct: number;
    returnCount: number;
    returnedAmountCents: number;
    // I2B-1: additional canonical fields (parity-required — the same values
    // Reports shows for this local day). Negative values preserved.
    costCents: number;
    grossTaxCents: number;
    netTaxCents: number;
    transactionCount: number;
    profitEstimated: boolean;
    marginMeaningful: boolean;
    hasData: boolean;
    // R-INTELLIGENCE-EOD-A2A: tender + fees/tax breakdowns. Cash/card/storeCredit
    // and the tax/fee buckets are canonical (I2B-1); otherCents + creditCardFee
    // are raw day-scoped residuals canonical does not expose. hasSalesData marks
    // whether any active sale backs these (else all zero).
    tenderBreakdown: {
      cashCents: number;
      cardCents: number;
      storeCreditCents: number;
      externalCents: number;
      otherCents: number;
    };
    feesAndTaxes: {
      salesTaxCents: number;
      utilityTaxCents: number;
      caMobilityFeeCents: number;
      cbeFeeCents: number;
      screenFeeCents: number;
      creditCardFeeCents: number;
      totalCents: number;
    };
    hasSalesData: boolean;
  } {
    // Canonical money for THIS local calendar day over the raw scoped snapshot
    // (the same wiring getTodayMetrics uses). Financial math is owned entirely
    // by computeReportMoneyStats — never re-derived here. `range` is computed
    // ONCE and shared with the auxiliary filters below so both sides always
    // agree on the day even across a midnight tick (I2B-1.1).
    const range = localDayRangeForDay(new Date());
    const snapshot = this.canonicalMoneySnapshot();
    const c = computeCanonicalMoneyForRange(snapshot, range);

    // Day-scoping for the NON-canonical display residuals + activity counts.
    // I2B-1.1: BOTH boundaries of the SAME canonical local-day range — the
    // previous `t >= todayMs` lower-bound-only filter let future-dated sales/
    // returns leak into returnCount / hasData / hasSalesData / otherCents /
    // creditCardFeeCents. Membership uses the SAME inclusive helper the
    // canonical service uses (isWithinLocalDayRange) — never a re-derived
    // day algorithm. Timestamp resolution handles Firestore Timestamp
    // (.toDate) and ISO strings/Date alike; unparseable ⇒ excluded.
    const dateOf = (rec: { createdAt?: unknown }): Date | null => {
      const ca = rec.createdAt;
      if (!ca) return null;
      try {
        const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
          ? (ca as { toDate: () => Date }).toDate()
          : new Date(ca as string | Date);
        return isNaN(d.getTime()) ? null : d;
      } catch { return null; }
    };
    const daySales = (snapshot.sales || []).filter(
      (s) => isWithinLocalDayRange(dateOf(s as { createdAt?: unknown }), range),
    );
    const dayReturns = (snapshot.customerReturns || []).filter(
      (r) => isWithinLocalDayRange(dateOf(r as { createdAt?: unknown }), range),
    );

    // Display residuals ONLY: otherCents (unknown/legacy payment methods) and
    // creditCardFeeCents — the two breakdown fields the canonical service does
    // not model. Same active (non-voided) day set the A2A view always used.
    // No tax/profit/refund math — every canonical value comes from `c` above.
    const activeDaySales = daySales.filter((s) => s.status !== 'voided');
    let otherCents = 0;
    let creditCardFeeCents = 0;
    for (const s of activeDaySales) {
      const pm = String(s.paymentMethod || '').trim().toLowerCase().replace(/\s+/g, '_');
      const isKnownTender = pm === 'cash' || pm === 'card' || pm === 'store_credit'
        || (pm === 'split' && !!s.splitPayment);
      if (!isKnownTender) otherCents += s.total || 0; // canonical drops these
      creditCardFeeCents += s.creditCardFee || 0;
    }

    const feesTotalCents =
      c.productSalesTaxCents + c.utilityTaxCents + c.mobilitySurchargeCents +
      c.cbeCollectedCents + c.screenFeeCents + creditCardFeeCents;

    return {
      grossRevenueCents: c.grossSalesCents,
      netRevenueCents: c.netSalesCents,
      grossProfitCents: c.totalProfitCents,
      // Round to one decimal — display-stable, deterministic.
      profitMarginPct: Math.round(c.profitMargin * 10) / 10,
      returnCount: dayReturns.length,
      returnedAmountCents: c.returnAndRefundAdjustmentsCents,
      costCents: c.totalCostCents,
      grossTaxCents: c.grossTaxCollectedCents,
      netTaxCents: c.netTaxCents,
      transactionCount: c.txCount,
      profitEstimated: c.profitAdjustmentEstimated,
      marginMeaningful: c.profitMarginMeaningful,
      hasData: daySales.length > 0 || dayReturns.length > 0,
      tenderBreakdown: {
        cashCents: c.cashCents,
        cardCents: c.cardCents,
        storeCreditCents: c.storeCreditCents,
        externalCents: 0, // no external/carrier PaymentMethod exists today
        otherCents,
      },
      feesAndTaxes: {
        salesTaxCents: c.productSalesTaxCents,
        utilityTaxCents: c.utilityTaxCents,
        caMobilityFeeCents: c.mobilitySurchargeCents,
        cbeFeeCents: c.cbeCollectedCents,
        screenFeeCents: c.screenFeeCents,
        creditCardFeeCents,
        totalCents: feesTotalCents,
      },
      hasSalesData: activeDaySales.length > 0,
    };
  }

  // R-INTEL-MULTI-PHONE-CUSTOMERS: exact count of customers carrying more
  // than one phone number. Uses the canonical phones[] array (Customer
  // model field set by multi-line phone support); legacy customers with
  // only a single string phone field count as 1. Pure compute — no cache,
  // no engine.refresh() needed.
  countMultiPhoneCustomers(): number {
    let count = 0;
    for (const c of this.customers) {
      const phones = (c as { phones?: unknown }).phones;
      if (Array.isArray(phones) && phones.filter((p) => typeof p === 'string' && p.trim().length > 0).length > 1) {
        count++;
      }
    }
    return count;
  }

  // R-PERF-INTELLIGENCE-CACHE: hot-swap input data without rebuilding the
  // engine instance. Module-side caller (IntelligenceModule.tsx) holds a
  // useRef-stable engine and calls updateData() per render — when refs
  // are unchanged this is a no-op (cheap), when changed it re-adapts the
  // data, rebuilds the analyzers/scorers (which hold internal data refs),
  // and invalidates the analyze() cache. Mirrors constructor data-setup
  // logic; intentionally does not touch this.config (config-level changes
  // still trigger a full engine rebuild on the module side).
  updateData(
    sales: Sale[],
    customers: Customer[],
    inventory: InventoryItem[],
    repairs: Repair[],
    extras: EngineExtras = {},
  ): void {
    const newSpecialOrders = extras.specialOrders ?? this._rawSpecialOrders;
    const newUnlocks = extras.unlocks ?? this._rawUnlocks;
    const newLayaways = extras.layaways ?? this._rawLayaways;
    const newCustomerReturns = extras.customerReturns ?? this._rawCustomerReturns;
    const newExpenses = extras.expenses ?? this._rawExpenses;
    const newEmployees = extras.employees ?? this._rawEmployees;
    const newAppointments = extras.appointments ?? this._rawAppointments;
    const newStoreCreditLedger = extras.storeCreditLedger ?? this._rawStoreCreditLedger;
    // R-CUSTOMER-PROFIT-PARITY-V1: keep settings live across re-renders.
    // Caller passes the latest settings each updateData() so commission
    // rate edits in Settings reflect immediately in customer history.
    if (extras.settings) this.profitSettings = extras.settings;
    // CELLHUB-INTELLIGENCE-I2A: keep vendor returns live (canonical money).
    if (extras.vendorReturns) this.vendorReturns = extras.vendorReturns;

    if (
      sales === this._rawSales
      && customers === this._rawCustomers
      && inventory === this._rawInventory
      && repairs === this._rawRepairs
      && newSpecialOrders === this._rawSpecialOrders
      && newUnlocks === this._rawUnlocks
      && newLayaways === this._rawLayaways
      && newCustomerReturns === this._rawCustomerReturns
      && newExpenses === this._rawExpenses
      && newEmployees === this._rawEmployees
      && newAppointments === this._rawAppointments
      && newStoreCreditLedger === this._rawStoreCreditLedger
    ) {
      return; // ref-equality: no work
    }

    this._rawSales = sales;
    this._rawCustomers = customers;
    this._rawInventory = inventory;
    this._rawRepairs = repairs;
    this._rawSpecialOrders = newSpecialOrders;
    this._rawUnlocks = newUnlocks;
    this._rawLayaways = newLayaways;
    this._rawCustomerReturns = newCustomerReturns;
    this._rawExpenses = newExpenses;
    this._rawEmployees = newEmployees;
    this._rawAppointments = newAppointments;
    this._rawStoreCreditLedger = newStoreCreditLedger;
    this.storeCreditLedger = newStoreCreditLedger;

    this.inventory = adaptInventory(inventory as unknown as unknown[]);
    this.sales = adaptSale(sales as unknown as unknown[], this.inventory);
    this.customers = adaptCustomer(customers as unknown as unknown[]);
    this.repairs = adaptRepair(repairs as unknown as unknown[]);
    this.specialOrders = newSpecialOrders;
    this.unlocks = newUnlocks;
    this.layaways = newLayaways;
    this.customerReturns = newCustomerReturns;
    this.expenses = newExpenses;
    this.employees = newEmployees;
    this.appointments = newAppointments;

    // Analyzers / scorers hold internal references to the data arrays they
    // were constructed with. Rebuild them so they see the fresh adapted
    // arrays. Constructor signatures + arg order kept identical to the
    // original constructor block above.
    this.salesAnalyzer = new SalesAnalyzer(this.sales, this.customers, this.config.storeId, this.config.lang, (window) => this.getCanonicalMoneyForWindow(window));
    this.inventoryAnalyzer = new InventoryAnalyzer(this.inventory, this.sales, undefined, this.config.lang);
    this.repairAnalyzer = new RepairAnalyzer(this.repairs, this.config.storeId, this.config.lang);
    // R-INTELLIGENCE-BEST-CUSTOMER-DATA-BUG-EXTEND: customers are global — see CustomerScorer note above.
    this.customerAnalyzer = new CustomerAnalyzer(this.customers, this.sales, undefined, this.config.lang, () => this.getCustomerValueProfiles());
    this.financialAnalyzer = new FinancialAnalyzer(this.sales, this.repairs, [], this.config.storeId, this.config.lang, (window) => this.getCanonicalMoneyForWindow(window));
    // R-INTELLIGENCE-BEST-CUSTOMER-DATA-BUG: customers are global — see
    // detailed note above the matching call in the constructor.
    this.customerScorer = new CustomerScorer(this.customers, this.sales, undefined, this.config.lang);
    this.inventoryScorer = new InventoryScorer(this.inventory, this.sales, this.config.storeId, this.config.lang);
    this.repairScorer = new RepairScorer(this.repairs, this.config.storeId, this.config.lang);
    // alertEngine does not hold data refs (only thresholds + lang) — keep.

    // Invalidate analyze() cache so next call recomputes against fresh data.
    // R-OPERATOR-WHATSAPP-PERFORMANCE-ARCHITECTURE-AUDIT-V1: also clear the
    // per-getter caches added this round.
    // R-INTEL-CUSTOMER-INDEX-V1: also clear per-customer history cache.
    this.cachedResult = undefined;
    this.lastRun = undefined;
    this.cachedReorderRecs = undefined;
    this.cachedMissedRev = undefined;
    this.cachedProductOpps = undefined;
    this.cachedCustomerHistory = undefined;
    this.cachedCustomerValueProfiles = undefined; // I2B-2: invalidate on data change
    this.cachedBaseline = undefined;
    this.cachedTrendReport = undefined;
    this.cachedProactiveReport = undefined;
    this.cachedExecutionReport = undefined;
    this.cachedMorningDigest = undefined;
    this.cachedReasoningReport = undefined;
    this.cachedDecisionReport = undefined;
  }

  // R-OPERATOR-STABILIZATION-AUDIT-V1: explicit cache-invalidation knob for
  // the Refresh button. Previously, the module signaled "refresh" by adding
  // refreshKey to engineConfigSig, which forced a brand-new IntelligenceEngine
  // instance (5 analyzers + 3 scorers + adapter passes — wasted work since
  // the data refs were unchanged). The correct semantic is "expire the
  // 60-second analyze() cache and let the next memo recomputation run analyze()
  // from scratch", which this method does in two assignments.
  // R-OPERATOR-WHATSAPP-PERFORMANCE-ARCHITECTURE-AUDIT-V1: now also clears
  // per-getter caches.
  // R-INTEL-CUSTOMER-INDEX-V1: now also clears per-customer history cache.
  invalidateCache(): void {
    this.cachedResult = undefined;
    this.lastRun = undefined;
    this.cachedReorderRecs = undefined;
    this.cachedMissedRev = undefined;
    this.cachedProductOpps = undefined;
    this.cachedCustomerHistory = undefined;
    this.cachedCustomerValueProfiles = undefined; // I2B-2: invalidate on data change
    this.cachedBaseline = undefined;
    this.cachedTrendReport = undefined;
    this.cachedProactiveReport = undefined;
    this.cachedExecutionReport = undefined;
    this.cachedMorningDigest = undefined;
    this.cachedReasoningReport = undefined;
    this.cachedDecisionReport = undefined;
  }

  // R-INTEL-AUTO-ACTION-QUEUE: deterministic top-3 outreach candidates,
  // mirrors the score/eligibility/decision-tree of handleWhoToContactToday
  // but emits ActionQueueItem instead of chat strings. Pure compute — no
  // localStorage access here (actions.ts handles persistence).
  // R-INTEL-AUTO-ACTION-QUEUE-ARCH-FIX: now public — chat handler calls
  // it directly so only the who_to_contact_today intent triggers queue
  // persistence (engine.refresh() is side-effect-free).
  buildOutreachQueueItems(): ActionQueueItem[] {
    const scores = this.cachedResult?.customerScores ?? [];
    if (scores.length === 0) return [];

    type Cand = {
      customerId: string;
      name: string;
      phone: string;
      grossRevenue: number;
      visitCount: number;
      daysSinceLastVisit: number;
      repairCount: number;
      rank: number;
    };

    // R-INTENT-CONTACT-TODAY-CONSENT-GUARD-QUEUE: parity with handler — exclude
    // opted-out customers from the persisted queue. Undefined = allowed.
    const consentById = new Map(this.getCustomers().map((c) => [c.id, c.communicationConsent]));

    const now = Date.now();
    const cands: Cand[] = [];
    for (const cs of scores) {
      const h = this.getCustomerHistory(cs.customerId);
      if (!h) continue;
      const phone = h.customer.phone || '';
      if (!phone) continue;
      if (consentById.get(cs.customerId) === false) continue;
      if (h.visitCount < 1) continue;
      if (!h.lastVisit) continue;
      const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
      const rank = (h.grossRevenue / 100) + days * 2 + h.visitCount * 10;
      cands.push({
        customerId: cs.customerId,
        name: h.customer.name,
        phone,
        grossRevenue: h.grossRevenue,
        visitCount: h.visitCount,
        daysSinceLastVisit: days,
        repairCount: h.linkedEntities?.repairCount || 0,
        rank,
      });
    }
    if (cands.length === 0) return [];

    const inactivePool = cands.filter((c) => c.daysSinceLastVisit >= 14);
    const pool = inactivePool.length >= 3 ? inactivePool : cands;

    const sortedSpend = cands.map((c) => c.grossRevenue).sort((a, b) => a - b);
    const q3Index = Math.max(0, Math.floor(sortedSpend.length * 0.75));
    const highSpenderThreshold = sortedSpend[q3Index] || 0;

    const top = pool.slice().sort((a, b) => b.rank - a.rank).slice(0, 3);

    const items: ActionQueueItem[] = [];
    for (const c of top) {
      const inactive = c.daysSinceLastVisit >= 14;
      const recent = !inactive;
      const highSpender = c.grossRevenue >= highSpenderThreshold && c.grossRevenue > 0;
      const firstName = c.name.split(' ')[0] || c.name;

      let reason: string;
      if (recent) {
        reason = `${c.name} bought ${c.daysSinceLastVisit} day(s) ago — fresh in mind`;
      } else if (highSpender) {
        reason = `${c.name} has spent $${(c.grossRevenue / 100).toFixed(2)} but hasn't visited in ${c.daysSinceLastVisit} days`;
      } else {
        reason = `${c.name} has ${c.visitCount} visits but hasn't been in for ${c.daysSinceLastVisit} days`;
      }

      let message: string;
      if (c.repairCount > 0) {
        message = `Hi ${firstName}, following up on your repair — how's everything working out?`;
      } else if (recent) {
        message = `Hi ${firstName}, thanks for stopping by! Interested in any accessories or add-ons?`;
      } else if (highSpender) {
        message = `Hi ${firstName}, we miss you — here's 10% off your next visit, or stop by for a free check-up.`;
      } else {
        message = `Hi ${firstName}, do you need a refill or any phone supplies? We've got you covered.`;
      }

      // Priority: rank baseline + boosts per spec (high-value, inactive 14+).
      let priority = Math.round(c.rank);
      if (highSpender) priority += 1000;
      if (c.daysSinceLastVisit >= 14) priority += 500;

      items.push({
        id: `wac-${c.customerId}-${now}`,
        type: 'whatsapp',
        customerId: c.customerId,
        phone: c.phone,
        message,
        priority,
        reason,
        createdAt: now,
      });
    }
    return items;
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

  // R-INTEL-2-REORDER: full reorder recommendations with suggested qty,
  // priority tier, and lost-revenue risk. Supersedes the binary
  // getReorderAlerts() insight for action-oriented consumers.
  // R-OPERATOR-WHATSAPP-PERFORMANCE-ARCHITECTURE-AUDIT-V1: memoized — module
  // memo + chat handlers no longer pay the inventory+sales scan twice.
  getReorderRecommendations(): ReorderRecommendation[] {
    if (this.cachedReorderRecs) return this.cachedReorderRecs;
    const result = this.inventoryAnalyzer.getReorderRecommendations(this.config.leadTimeDays ?? 3);
    this.cachedReorderRecs = result;
    return result;
  }

  // R-INTEL-2-CONTACT: overdue customers sorted by urgency.
  // Only customers with visitCount >= 2 (established cadence) are included.
  getNextVisitPredictions(topN: number = 10): NextVisitPrediction[] {
    return this.customerAnalyzer.getNextVisitPredictions(topN);
  }

  // R-INTEL-2-MISSED: aggregate missed-revenue signals from sales and
  // inventory analyzers into a single report for the chat handler + future UI.
  // R-OPERATOR-WHATSAPP-PERFORMANCE-ARCHITECTURE-AUDIT-V1: memoized — three
  // analyzer scans (sales×2 + inventory×1) collapse to a single cached read
  // until updateData/invalidateCache fires.
  getMissedRevenue(): MissedRevenueReport {
    if (this.cachedMissedRev) return this.cachedMissedRev;
    const { slowDayLossCents, slowestDayName } = this.salesAnalyzer.getMissedRevenueByDay();
    const { slowHourLossCents } = this.salesAnalyzer.getMissedRevenueByHour();
    const { deadStockLockedCents, opportunityCostCents } = this.inventoryAnalyzer.getDeadStockOpportunityCost();
    const result: MissedRevenueReport = { slowDayLossCents, slowestDayName, slowHourLossCents, deadStockLockedCents, opportunityCostCents };
    this.cachedMissedRev = result;
    return result;
  }

  // R-INTELLIGENCE-CONTEXTUAL-BASELINE-ENGINE-V1: store-aware operational
  // baseline computed over the last 30 days of sales. Memoized — same
  // cache lifecycle as cachedMissedRev (cleared on updateData/invalidateCache).
  getContextualBaseline(): ContextualBaseline {
    if (this.cachedBaseline) return this.cachedBaseline;
    const result = computeContextualBaseline(this.sales);
    this.cachedBaseline = result;
    return result;
  }

  // R-INTELLIGENCE-TREND-DIRECTION-V1: detect whether the store is improving,
  // declining, stable, recovering, or worsening over the last 7 days.
  // Memoized — same lifecycle as cachedBaseline.
  getTrendDirectionReport(): TrendDirectionReport {
    if (this.cachedTrendReport) return this.cachedTrendReport;
    const result = computeTrendDirectionReport(this.sales, this.getContextualBaseline());
    this.cachedTrendReport = result;
    return result;
  }

  // R-INTELLIGENCE-AUTO-RESOLUTION-V1: scan all pending queue items and
  // silently resolve any whose underlying operational issue has cleared.
  // R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1: also auto-completes any linked workflow.
  // R-INTELLIGENCE-OUTCOME-TRACKING-V1: also evaluates pending outcomes.
  // O(n) over pending items (expected < 200). Called by IntelligenceModule
  // after each data update — returns count of newly resolved items so the
  // caller can decide whether to reload queue state.
  runAutoResolution(): number {
    const pending = getQueue().filter(i => i.status === 'pending');
    let count = 0;
    for (const item of pending) {
      const result = evaluateQueueAutoResolution(item, this);
      if (result.resolved && result.reason) {
        autoResolveQueueItem(item.id, result.reason);
        if (item.workflowId) {
          autoCompleteWorkflow(item.workflowId, result.reason);
        }
        count++;
      }
    }
    this.runOutcomeEvaluation();
    return count;
  }

  // R-INTELLIGENCE-OUTCOME-TRACKING-V1: evaluate all pending outcomes against
  // current entity state. Silent — no popups, no queue writes. Returns count
  // of newly resolved outcomes. Engine satisfies OutcomeEvalContext structurally.
  runOutcomeEvaluation(): number {
    return evaluatePendingOutcomes(this as unknown as OutcomeEvalContext);
  }

  // R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: ranked list of the highest-ROI
  // operational actions the operator should take right now. Memoized — same
  // cache lifecycle as other per-getter caches (cleared on updateData/invalidateCache).
  // Engine satisfies ProactiveEvalContext structurally (no direct type import).
  getProactiveReport(): ProactiveOperationsReport {
    if (this.cachedProactiveReport) return this.cachedProactiveReport;
    const result = generateProactiveOperationsReport(
      this as unknown as ProactiveEvalContext,
      this.config.lang,
    );
    this.cachedProactiveReport = result;
    return result;
  }

  // R-INTELLIGENCE-AUTOMATED-EXECUTION-V1: ranked list of execution-ready
  // actions with pre-built draft messages. Derives from the proactive report
  // (no duplicate scanning). Memoized — same lifecycle as proactiveReport.
  // Engine satisfies ExecutionEvalContext structurally (no direct type import).
  getExecutionReport(): ExecutionReport {
    if (this.cachedExecutionReport) return this.cachedExecutionReport;
    const result = generatePreparedExecutions(
      this as unknown as ExecutionEvalContext,
      this.config.lang,
    );
    this.cachedExecutionReport = result;
    return result;
  }

  // R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1: pre-shift operational briefing.
  // Aggregates proactive, execution, trend, workflow, and queue signals into a
  // time-of-day-ordered digest. Memoized — same lifecycle as other per-getter caches.
  // Engine satisfies DigestEvalContext structurally (no direct type import).
  getMorningDigest(): MorningDigest {
    if (this.cachedMorningDigest) return this.cachedMorningDigest;
    const result = generateMorningDigest(
      this as unknown as DigestEvalContext,
      this.config.lang,
    );
    this.cachedMorningDigest = result;
    return result;
  }

  // R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1: correlates signals across modules
  // to infer what is actually happening in the business. Memoized — same lifecycle
  // as other per-getter caches. Engine satisfies ReasoningEvalContext structurally.
  getOperationalReasoningReport(): OperationalReasoningReport {
    if (this.cachedReasoningReport) return this.cachedReasoningReport;
    const result = generateOperationalReasoningReport(this as unknown as ReasoningEvalContext);
    this.cachedReasoningReport = result;
    return result;
  }

  // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: translates operational conditions
  // into best strategic move for the operator. Memoized — same lifecycle as other
  // per-getter caches. Engine satisfies DecisionEvalContext structurally.
  getDecisionRecommendationReport(): DecisionRecommendationReport {
    if (this.cachedDecisionReport) return this.cachedDecisionReport;
    const result = generateDecisionRecommendationReport(this as unknown as DecisionEvalContext);
    this.cachedDecisionReport = result;
    return result;
  }

  // R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1: thin wrapper so callers (Companion,
  // chat handlers, future automation) can ensure/create workflows without
  // importing the flow engine directly. Returns the existing or new workflow.
  ensureWorkflow(params: EnsureWorkflowParams): OperationalWorkflow {
    return ensureOperationalWorkflow(params);
  }

  // R-INTEL-2-PRODUCT: margin + velocity + return-rate opportunity classification.
  // Passes customerReturns so return rate can be approximated at sale level.
  // R-DAILY-BRIEF-ENGINE-V1: aggregate existing signals into one structured
  // payload. Pure compose — no recomputation, no queue writes, no string output.
  // Slices match the operator-console "what to do now" priority: top-3 outreach,
  // top-1 reorder, top-1 opportunity. All ingredient methods already cache.
  getDailyBrief(): DailyBriefResult {
    return {
      today: this.getTodayMetrics(),
      outreach: this.buildOutreachQueueItems().slice(0, 3),
      reorder: this.getReorderRecommendations().slice(0, 1),
      opportunities: this.getProductOpportunities(1),
      missed: this.getMissedRevenue(),
    };
  }

  // R-OPERATOR-WHATSAPP-PERFORMANCE-ARCHITECTURE-AUDIT-V1: memoized by topN.
  // Callers ask for varying slice sizes (1 from getDailyBrief, 3 from the
  // module top card, 10 default from chat handlers) — keep a small per-N
  // cache so each N is computed once until invalidated.
  getProductOpportunities(topN: number = 10): ProductOpportunity[] {
    if (!this.cachedProductOpps) this.cachedProductOpps = new Map();
    const cached = this.cachedProductOpps.get(topN);
    if (cached) return cached;
    const result = this.inventoryAnalyzer.getProductOpportunities(topN, this.customerReturns);
    this.cachedProductOpps.set(topN, result);
    return result;
  }

  // R-INTEL-PHASE2-RC: revenue decline root cause — compares last 7 days
  // vs prior 7 days and classifies the drop as traffic, ticket, or both.
  // Returns null when revenue is not down or prior-period data is absent.
  getRevenueRootCause(): RootCauseReport | null {
    return diagnoseRevenueDecline(this.sales);
  }

  // R-INTEL-PHASE2B-RC: slow day root cause — compares slowest DOW vs
  // best DOW over last 30 days and classifies as traffic, ticket, or mixed.
  // Returns null when fewer than 5 sales or <2 active days of week.
  getSlowDayRootCause(): SlowDayRootCauseReport | null {
    return diagnoseSlowDay(this.sales);
  }

  // R-INTEL-PHASE2C-RC: per-item dead stock root cause — explains WHY each
  // item is not moving. Returns empty array when nothing qualifies.
  getDeadStockRootCause(): DeadStockRootCauseReport[] {
    return diagnoseDeadStock(this.inventory, this.sales);
  }

  // R-INTEL-PHASE2D-RC: customer churn root cause — explains WHY each
  // inactive customer stopped coming. Returns empty array when none qualify.
  getChurnRootCause(): ChurnRootCauseReport[] {
    return diagnoseChurn(this.customers, this.sales);
  }

  // R-INTEL-CUSTOMER-HISTORY: per-customer rollup. Crosses analyzer
  // boundaries (combines sales/repairs/SOs/unlocks/layaways/returns)
  // so lives on the engine rather than in any single analyzer.
  //
  // Returns null if the customer isn't found. Callers should handle the
  // null case (e.g. disambiguate via fuzzy search before calling).
  getCustomerHistory(customerId: string): CustomerHistorySummary | null {
    // R-INTEL-CUSTOMER-INDEX-V1: cache check. Loop callers (buildOutreach,
    // runProductPush) re-ask for the same customers across iterations — and
    // even within a single chat query, multiple handlers may need the same
    // rollup. Cache hit is O(1) Map lookup; miss falls through to the full
    // computation below.
    if (!this.cachedCustomerHistory) this.cachedCustomerHistory = new Map();
    if (this.cachedCustomerHistory.has(customerId)) {
      return this.cachedCustomerHistory.get(customerId) ?? null;
    }
    const customer = this.customers.find(c => c.id === customerId);
    if (!customer) {
      this.cachedCustomerHistory.set(customerId, null);
      return null;
    }

    // CELLHUB-INTELLIGENCE-I2B-0.2: customer money AND history population
    // come from the RAW scoped snapshot (canonicalMoneySnapshot — the same
    // un-adapted collections Reports/Customer 360 read; I2A established
    // that schema-adapted engine arrays break canonical parity). Attribution
    // is the canonical policy (id → originalSaleId linkage → normalized
    // phone; never name) via attributeCustomerCollections — the SAME
    // implementation the modal and the customer list use. The money then
    // flows through computeProfileFromAttributed (I2B-0.1 canonical core:
    // commission precedence, refund/exchange reversal, commissionable
    // margin denominator). No re-filtering, no re-adaptation.
    const snap = this.canonicalMoneySnapshot();
    const rawCustomer = this._rawCustomers.find(c => c.id === customerId) ?? customer;
    const attributed = attributeCustomerCollections(rawCustomer, {
      sales: snap.sales,
      repairs: snap.repairs,
      unlocks: snap.unlocks,
      layaways: snap.layaways,
      specialOrders: snap.specialOrders,
      customerReturns: snap.customerReturns,
      // vendor returns are STORE-WIDE COGS adjustments — never passed into
      // a per-customer profile (excluded inside the profile core too).
    });
    const profile = computeProfileFromAttributed(attributed, {
      customer: rawCustomer,
      inventory: snap.inventory,
      settings: snap.settings,
    });

    // First / last visit — canonical countable population (same attributed
    // sales the financial profile counts; a phone-linked legacy invoice can
    // no longer be in the money but missing from the visit dates).
    const firstVisit = profile.firstVisitAt;
    const lastVisit = profile.lastVisitAt;

    // Top items by revenue (top 5) — attributed raw sales, non-voided.
    const itemMap: Record<string, { quantity: number; revenue: number }> = {};
    for (const sale of attributed.sales) {
      if (sale.status === 'voided') continue;
      for (const item of sale.items || []) {
        const key = item.name || 'Unknown';
        // Raw legacy lines may persist `quantity` instead of `qty`.
        const qty = item.qty ?? (item as unknown as { quantity?: number }).quantity ?? 0;
        itemMap[key] = {
          quantity: (itemMap[key]?.quantity || 0) + qty,
          revenue: (itemMap[key]?.revenue || 0) + ((item.price || 0) * qty),
        };
      }
    }
    const topItems = Object.entries(itemMap)
      .map(([name, d]) => ({ name, quantity: d.quantity, revenue: d.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Preferred payment method — most frequent across non-voided attributed sales.
    const paymentCount: Record<string, number> = {};
    for (const sale of attributed.sales) {
      if (sale.status === 'voided') continue;
      const pm = String(sale.paymentMethod || '').toLowerCase();
      if (!pm) continue;
      paymentCount[pm] = (paymentCount[pm] || 0) + 1;
    }
    const preferredPaymentMethod = Object.entries(paymentCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Linked entities — the ATTRIBUTED raw entity collections (identity or
    // referenced by the customer's own sale lines — same population whose
    // economics the profile already counts).
    const customerRepairs = attributed.repairs;
    const customerSOs = attributed.specialOrders;
    const customerUnlocks = attributed.unlocks;
    const customerLayaways = attributed.layaways;

    const repairTotalValue = customerRepairs.reduce(
      (s, r) => s + (r.total || r.estimatedCost || 0),
      0,
    );
    const activeBalance =
      customerRepairs.reduce((s, r) => s + (r.balance || 0), 0) +
      customerSOs.reduce((s, o) => s + (o.balance || 0), 0) +
      customerUnlocks.reduce((s, u) => s + (u.balance || 0), 0) +
      customerLayaways.reduce((s, l) => s + (l.balance || 0), 0);

    const summary: CustomerHistorySummary = {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        customerNumber: (customer as { customerNumber?: string }).customerNumber,
        loyaltyPoints: customer.loyaltyPoints || 0,
        storeCredit: customer.storeCredit || 0,
        carrier: (customer as { carrier?: string }).carrier,
      },
      // Legacy field names preserved for the ~20 consumers; VALUES are
      // canonical (I2B-0.1). margin is now over the commissionable pre-tax
      // base; costCoverage is the exact-economic-basis fraction (a
      // configured carrier commission counts as exact, not missing cost).
      grossRevenue: profile.totalCollectedCents,
      netRevenue: profile.netAfterReturnsCents,
      // returnAndRefundAdjustmentsCents is a POSITIVE magnitude
      // (netSales = gross − adjustments); clamp guards odd negatives.
      totalRefunded: Math.max(0, profile.returnsCents),
      profit: profile.profitCents,
      margin: profile.marginPercent,
      avgTicket: profile.averageTicketCents,
      visitCount: profile.visitCount,
      avgDaysBetweenVisits: profile.avgDaysBetweenVisits,
      costCoverage: profile.exactCoveragePercent / 100,
      topCategoryByProfit: profile.topCategoryByProfit,
      topCategoryProfit: profile.topCategoryProfitCents,
      // I2B-0.1: canonical money block — the exact fields Customer 360
      // renders, so chat surfaces can quote them without re-deriving.
      canonicalMoney: {
        totalCollectedCents: profile.totalCollectedCents,
        profitBearingRevenueCents: profile.profitBearingRevenueCents,
        profitCents: profile.profitCents,
        marginPercent: profile.marginPercent,
        marginMeaningful: profile.marginMeaningful,
        transactionCount: profile.transactionCount,
        averageTicketCents: profile.averageTicketCents,
        returnsCents: profile.returnsCents,
        netAfterReturnsCents: profile.netAfterReturnsCents,
        profitEstimated: profile.profitEstimated,
        estimatedPercent: profile.estimatedPercent,
        unavailablePercent: profile.unavailablePercent,
      },
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
    // R-INTEL-CUSTOMER-INDEX-V1: stash the result so subsequent same-id
    // calls within this data snapshot return O(1).
    this.cachedCustomerHistory!.set(customerId, summary);
    return summary;
  }

  // CELLHUB-INTELLIGENCE-I2B-2: canonical per-customer money profiles for
  // EVERY customer, batched (one bucketing pass) and memoized per data
  // snapshot. THE single source for customer-value analysis — same
  // attribution (id → originalSaleId linkage → normalized phone; never name)
  // and returns-aware Total Collected the Customer 360 list uses. Replaces
  // the legacy `sum(sale.total)` customerId-only rankings. Financial math is
  // owned by computeReportMoneyStats — never re-derived here.
  getCustomerValueProfiles(): Map<string, CustomerMoneyProfile> {
    if (this.cachedCustomerValueProfiles) return this.cachedCustomerValueProfiles;
    const snap = this.canonicalMoneySnapshot();
    const profiles = computeCustomerMoneyProfiles(this.customers, {
      sales: snap.sales,
      repairs: snap.repairs,
      unlocks: snap.unlocks,
      layaways: snap.layaways,
      specialOrders: snap.specialOrders,
      customerReturns: snap.customerReturns,
      inventory: snap.inventory,
      settings: snap.settings,
    });
    this.cachedCustomerValueProfiles = profiles;
    return profiles;
  }

  // I2B-2: top customers by canonical Total Collected (returns-aware,
  // attribution-correct) — the value ranking chat / rankings should quote.
  // Shape mirrors the legacy TopCustomer plus canonical money so callers can
  // present collected / profit / margin without re-deriving. Deterministic
  // tie-break by customerId so equal-value customers order stably.
  getTopCustomersByValue(limit: number = 5): Array<{
    customerId: string;
    name: string;
    phone?: string;
    revenueCents: number;            // = canonical Total Collected (gross, returns-aware)
    profitCents: number;
    marginPercent: number;
    marginMeaningful: boolean;
    transactionCount: number;
    netAfterReturnsCents: number;
  }> {
    const profiles = this.getCustomerValueProfiles();
    return this.customers
      .map((c) => {
        const p = profiles.get(c.id);
        return {
          customerId: c.id,
          name: c.name || '',
          phone: c.phone,
          revenueCents: p ? p.totalCollectedCents : 0,
          profitCents: p ? p.profitCents : 0,
          marginPercent: p ? p.marginPercent : 0,
          marginMeaningful: p ? p.marginMeaningful : false,
          transactionCount: p ? p.transactionCount : 0,
          netAfterReturnsCents: p ? p.netAfterReturnsCents : 0,
        };
      })
      .filter((c) => c.transactionCount > 0 || c.revenueCents !== 0)
      .sort((a, b) => (b.revenueCents - a.revenueCents) || a.customerId.localeCompare(b.customerId))
      .slice(0, limit);
  }

  // R-INTELLIGENCE-ATTENTION-MODEL-V1: current operator attention state derived
  // from local behavioral signals (dismissals, actions, checkout bursts, queue depth).
  // Thin wrapper — computeAttentionSnapshot reads from localStorage directly.
  getAttentionSnapshot(): AttentionSnapshot {
    return computeAttentionSnapshot();
  }

  // R-INTELLIGENCE-LIVE-OPERATING-ASSISTANT-V1: evaluate real-time operational
  // windows and return the highest-priority suggestion for the operator.
  // Not cached — result depends on LiveAssistContext (idle time, modal state)
  // which changes independently of store data. Cooldowns are managed in
  // liveOperatingAssistant.ts via localStorage.
  // Engine satisfies LiveAssistEvalContext structurally (no direct type import).
  getLiveAssistSuggestion(context: LiveAssistContext): LiveAssistSuggestion | null {
    return generateLiveAssistSuggestion(
      this as unknown as LiveAssistEvalContext,
      context,
      this.config.lang,
    );
  }
}