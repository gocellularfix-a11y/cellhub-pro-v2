// ============================================================
// CellHub Intelligence — Business Manager layer (I4) — types.
//
// PROACTIVE layer over the I3-3 Business Analyst: everything here CONSUMES
// BusinessInsightsResult (findings/cards/suggestions) — no canonical money,
// no parser, no new financial formulas. Deterministic rule templates only;
// structured models first, text only in the presenter. API only — no UI.
// ============================================================

import type { InsightFinding, InsightSeverity, SuggestedQuestion, TrendDirection } from '../insights/types';

// ── executive summary (Part 2) — structured items, text in presenter ──
export type ExecutiveSummaryKind =
  | 'metric_direction'          // {metric, direction}
  | 'carrier_strongest_growth'  // {carrier}
  | 'service_declined'          // {population}
  | 'service_grew'              // {population}
  | 'customer_returned'         // {name, absenceDays}
  | 'customers_lost'            // {count}
  | 'no_significant_changes';

export interface ExecutiveSummaryItem {
  kind: ExecutiveSummaryKind;
  data: Record<string, string | number>;
  sourceFindingId?: string;
}

// ── actions (Parts 3 + 10 — typed contracts, no storage) ────
export type BusinessActionKind =
  | 'review_inventory_pricing'
  | 'compare_carrier_previous_period'
  | 'contact_customer'
  | 'review_service_promotion'
  | 'review_pricing_and_costs'
  | 'review_day_operations'
  | 'review_refunds'
  | 'review_employee_activity'
  | 'thank_returning_customer'
  | 'lean_into_carrier_growth';

export type BusinessActionPriority = 'critical' | 'high' | 'medium' | 'low';
export type BusinessActionStatus = 'created' | 'resolved' | 'dismissed';

export interface BusinessAction {
  /** Deterministic id: `${kind}:${findingId}`. */
  id: string;
  kind: BusinessActionKind;
  priority: BusinessActionPriority;
  status: BusinessActionStatus;      // future persistence contract — always 'created' here
  relatedFindingId: string;
  /** YMD stamp derived from the analyzed range end (deterministic). */
  createdYMD: string;
  data: Record<string, string | number | boolean | null>;
}

// ── business score (Part 4) ─────────────────────────────────
export interface BusinessScore {
  /** 0..100, deterministic from findings only. */
  score: number;
  /** Per-severity counts + applied deltas for full reproducibility. */
  breakdown: {
    criticalCount: number; warningCount: number; opportunityCount: number; positiveCount: number;
    trendDirection: TrendDirection | null;   // headline gross_sales trend
    appliedDelta: number;                    // total delta vs the 100 base
  };
}

// ── health sections (Part 5) ────────────────────────────────
export type HealthSectionKey =
  | 'revenue' | 'profit' | 'margin' | 'customers'
  | 'employees' | 'inventory' | 'services' | 'carriers';

export type HealthStatus = 'healthy' | 'watch' | 'critical';

export interface HealthSection {
  key: HealthSectionKey;
  status: HealthStatus;
  /** Exact reasons — the finding ids that produced this status. */
  reasonFindingIds: string[];
}

// ── priority queue (Part 6) ─────────────────────────────────
export interface PriorityItem {
  /** 'finding' entries reference an InsightFinding; 'action' a BusinessAction. */
  itemType: 'finding' | 'action';
  refId: string;
  severity: InsightSeverity | BusinessActionPriority;
  /** Deterministic sort inputs. */
  impact: number;
  confidence: number;
  dateYMD: string;
}

// ── business brief (Part 1) ─────────────────────────────────
export interface BusinessBrief {
  generatedForRange: { startYMD: string; endYMD: string };
  executiveSummary: ExecutiveSummaryItem[];
  criticalAlerts: InsightFinding[];
  warnings: InsightFinding[];
  opportunities: InsightFinding[];
  positiveHighlights: InsightFinding[];
  recommendedActions: BusinessAction[];
  suggestedQuestions: SuggestedQuestion[];
  score: BusinessScore;
  health: HealthSection[];
  priorityQueue: PriorityItem[];
}

// ── manager dashboard (Parts 7 + 12 — typed API, no UI) ─────
export interface ManagerDashboard {
  overview: {
    score: BusinessScore;
    health: HealthSection[];
    generatedForRange: { startYMD: string; endYMD: string };
    executiveSummary: ExecutiveSummaryItem[];
  };
  todaysFocus: PriorityItem | null;
  businessScore: BusinessScore;
  alerts: InsightFinding[];               // critical + warning
  topOpportunities: InsightFinding[];
  topRisks: InsightFinding[];
  recentImprovements: InsightFinding[];   // positive trends/growth
  recentDeclines: InsightFinding[];
  recommendedActions: BusinessAction[];
  quickQuestions: SuggestedQuestion[];
}

// ── digest (Part 8) ─────────────────────────────────────────
export type DigestRangeKind = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days';

export interface BusinessDigest {
  rangeKind: DigestRangeKind;
  brief: BusinessBrief;
}

// ── notification contracts (Part 11 — contracts only) ───────
export type NotificationKind = 'alert' | 'reminder' | 'opportunity' | 'critical_warning' | 'recovery' | 'success';

export interface NotificationContract {
  id: string;                      // deterministic: `${kind}:${sourceId}`
  kind: NotificationKind;
  severity: InsightSeverity;
  sourceFindingId?: string;
  sourceActionId?: string;
  dateYMD: string;
  data: Record<string, string | number | boolean | null>;
}
