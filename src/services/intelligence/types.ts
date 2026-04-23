// CellHub Intelligence Engine — Type Definitions

export interface Insight {
  id: string;
  category: 'sales' | 'inventory' | 'repairs' | 'customers' | 'financial';
  severity: 'critical' | 'warning' | 'info' | 'opportunity';
  title: string;
  titleEs: string;
  description: string;
  descriptionEs: string;
  metric?: number;
  metricLabel?: string;
  trend?: 'up' | 'down' | 'flat';
  trendPercent?: number;
  actionLabel?: string;
  actionLabelEs?: string;
  actionRoute?: string;
  confidence: number;
  generatedAt: Date;
  expiresAt: Date;
  data?: Record<string, unknown>;
}

export interface IntelligenceReport {
  id?: string;
  generatedAt: Date;
  storeId?: string;
  window?: AnalysisWindow;
  insights: Insight[];
  sales?: SalesMetrics;
  inventory?: InventoryMetrics;
  repairs?: RepairMetrics;
  customers?: CustomerMetrics;
  financial?: FinancialMetrics;
  kpis?: KPIDashboard;
  health?: StoreHealthScore;
}

export interface KPIDashboard {
  storeId?: string;
  period: string;
  startDate: Date;
  endDate: Date;
  revenue: {
    current: number;
    previous: number;
    trend: 'up' | 'down' | 'flat';
    trendPercent: number;
  };
  transactions: {
    count: number;
    avgSize: number;
  };
  inventory: {
    totalValue: number;
    totalItems: number;
    lowStockCount: number;
    deadStockCount: number;
  };
  repairs: {
    pending: number;
    overdue: number;
  };
  customers: {
    total: number;
    new: number;
    returning: number;
  };
  topItems?: Array<{ name: string; quantity: number; revenue: number }>;
  slowDays?: Array<{ day: string; revenue: number }>;
  hourlyHeatmap?: Record<number, number>;
}

export interface StoreHealthScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: string[];
  title: string;
  titleEs: string;
  generatedAt: Date;
  overall?: number;
  sales?: number;
  inventory?: number;
  repairs?: number;
  customers?: number;
  financial?: number;
}

export interface AnalysisWindow {
  start: Date;
  end: Date;
  label: string;
}

export interface PriceSuggestion {
  inventoryId: string;
  currentPrice: number;
  suggestedPrice: number;
  reasoning: string;
  reasoningEs: string;
  confidence: number;
}

export interface ForecastResult {
  inventoryId: string;
  itemName: string;
  predictedDemand7Days: number;
  predictedDemand30Days: number;
  confidence: number;
}

export interface SalesMetrics {
  totalRevenue: number;
  transactionCount: number;
  avgTransactionSize: number;
  paymentMethodBreakdown: Record<string, number>;
  dailyRevenue: number[];
  categoryBreakdown: Record<string, number>;
}

export interface InventoryMetrics {
  totalValue: number;
  totalItems: number;
  deadStockCount: number;
  reorderAlertCount: number;
  categoryDistribution: Record<string, number>;
}

export interface RepairMetrics {
  totalCompleted: number;
  avgTurnaroundHours: number;
  byType: Record<string, number>;
  overdueCount: number;
}

export interface CustomerMetrics {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  churnRiskCount: number;
  vipCount: number;
  avgLTV: number;
}

export interface FinancialMetrics {
  grossMargin: number;
  expenseRatio: number;
  cbeCollected: number;
  creditCardFees: number;
  cashFlowByDay: Record<string, number>;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// R-INTEL-CUSTOMER-HISTORY: per-customer rollup for the lookup card
// + future chat "historial de X" intent. Composes computeCustomerProfit
// (src/utils/customerProfit.ts) with first/last visit, top items,
// preferred payment, and linked-entity counts.
export interface CustomerHistorySummary {
  customer: {
    id: string;
    name: string;
    phone?: string;
    customerNumber?: string;
    loyaltyPoints: number;
    storeCredit: number;            // cents
    carrier?: string;
  };
  // Financial rollup (from customerProfit helper) — all cents.
  grossRevenue: number;
  netRevenue: number;
  totalRefunded: number;
  profit: number;
  margin: number;                   // percentage, e.g. 23.5
  avgTicket: number;                // cents
  visitCount: number;
  avgDaysBetweenVisits: number | null;
  costCoverage: number;             // 0..1 — fraction of sales with known cost
  topCategoryByProfit: string | null;
  topCategoryProfit: number;        // cents

  firstVisit: Date | null;
  lastVisit: Date | null;
  topItems: Array<{ name: string; quantity: number; revenue: number }>;
  preferredPaymentMethod: string | null;

  linkedEntities: {
    repairCount: number;
    repairTotalValue: number;       // cents
    specialOrderCount: number;
    unlockCount: number;
    layawayCount: number;
    activeBalance: number;          // cents — sum of outstanding balances
  };
}