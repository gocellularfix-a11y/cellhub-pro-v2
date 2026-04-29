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

// R-INTEL-2-MISSED: aggregate missed-revenue signals for the
// "what is hurting my profit?" chat intent and future dashboard card.
export interface MissedRevenueReport {
  slowDayLossCents: number;       // weekly revenue gap: best DOW minus slowest DOW
  slowestDayName: string;         // English name of the slowest day of week
  slowHourLossCents: number;      // daily sum of off-peak gaps vs peak hour
  deadStockLockedCents: number;   // capital tied up in dead inventory (cost basis)
  opportunityCostCents: number;   // 2%/month holding cost on dead stock
}

// R-INTEL-2-CONTACT: per-customer next-visit prediction for the
// "who should I contact today?" chat intent and future contact-list UI.
export interface NextVisitPrediction {
  customerId: string;
  name: string;
  phone?: string;
  lastVisit: Date;
  avgDaysBetweenVisits: number;
  predictedNextVisit: Date;
  overdueByDays: number;       // positive = overdue, negative = not yet due
  urgencyScore: number;        // overdueByDays / avgDaysBetweenVisits (0..∞)
  confidence: number;          // min(visitCount / 5, 1.0)
}

// R-INTEL-2-REORDER: full reorder recommendation — extends the binary
// reorder alert with suggested qty, lost-revenue risk, and priority tier.
export interface ReorderRecommendation {
  inventoryId: string;
  name: string;
  currentQty: number;
  avgDailySales: number;       // units/day (float)
  daysLeft: number;            // days of stock at current velocity
  reorderPoint: number;        // qty threshold that triggered the recommendation
  suggestedOrderQty: number;   // units to order to restore safety stock
  lostRevenueRiskCents: number; // estimated revenue lost during stockout window
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

// R-INTEL-2-PRODUCT: margin + velocity + return-rate classification for the
// "what should I promote or discount?" chat intent and future product-opportunity UI.
export interface ProductOpportunity {
  inventoryId: string;
  name: string;
  type: 'HIGH_MARGIN' | 'LOW_MARGIN' | 'DEAD_STOCK' | 'HIGH_RETURN';
  marginPct: number;          // (price - cost) / price * 100; 0 if cost unknown
  avgDailySales: number;      // units/day over last 30 days
  qty: number;
  daysSinceLastSale: number | null;
  returnRate: number;         // 0..1 (returned sales / total sales containing item)
  action: 'PROMOTE' | 'DISCOUNT' | 'BUNDLE' | 'REVIEW';
  impactCents: number;        // estimated revenue / margin impact over 30 days
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
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

// R-INTEL-PHASE2-RC: root cause analysis types
export interface ActionItem {
  labelKey: string;         // i18n key: chat.rootCause.action.*
  effort: 'low' | 'medium' | 'high';
  priority: number;         // 1 = highest
}

export type RevenueDiagnosis = 'traffic' | 'ticket' | 'both';

export interface RootCauseReport {
  triggerKind: 'revenue_decline';
  diagnosis: RevenueDiagnosis;
  revCurrentCents: number;
  revPreviousCents: number;
  txCurrent: number;
  txPrevious: number;
  avgTicketCurrentCents: number;
  avgTicketPreviousCents: number;
  revDropCents: number;
  txDropPct: number;        // integer percentage, e.g. 22 = 22%
  ticketDropPct: number;    // integer percentage
  confidence: number;       // 0..1, based on sample size
  actions: ActionItem[];
}

// R-INTEL-PHASE2B-RC: slow day root cause report
export interface SlowDayRootCauseReport {
  slowestDayName: string;           // English DOW, e.g. 'Sunday'
  bestDayName: string;              // English DOW
  slowestDayIndex: number;          // 0 = Sunday … 6 = Saturday
  bestDayIndex: number;
  slowDayRevenueCents: number;      // avg revenue per occurrence
  bestDayRevenueCents: number;
  weeklyGapCents: number;           // bestDayRevenue - slowDayRevenue
  slowDayTxCount: number;           // avg transactions per occurrence (rounded)
  bestDayTxCount: number;
  slowDayAvgTicketCents: number;
  bestDayAvgTicketCents: number;
  txDiffPct: number;                // integer %
  ticketDiffPct: number;            // integer %
  diagnosis: 'traffic' | 'ticket' | 'mixed';
  confidence: number;               // 0..1, based on weeks of data
  actions: ActionItem[];
}

// R-INTEL-PHASE2C-RC: per-item dead stock root cause report
export interface DeadStockRootCauseReport {
  sku: string;
  name: string;
  daysWithoutSale: number;
  stockUnits: number;
  avgWeeklySales: number;           // units/week over last 60 days
  lastSaleDaysAgo: number;
  marginPct: number | null;         // null when cost is unknown
  diagnosis: 'no_demand' | 'low_visibility' | 'pricing_issue' | 'mixed';
  confidence: number;               // 0..1, min(1, lastSaleDaysAgo / 30)
  actions: ActionItem[];
}

export interface ChurnRootCauseReport {
  customerId: string;
  name: string;
  lastVisitDaysAgo: number;
  avgVisitGapDays: number;
  totalVisits: number;
  diagnosis: 'lost_habit' | 'price_sensitivity' | 'one_time' | 'mixed';
  confidence: number;               // 0..1, min(1, totalVisits / 5)
  actions: ActionItem[];
}