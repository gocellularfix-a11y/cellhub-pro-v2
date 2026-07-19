// ============================================================
// CellHub Intelligence — Business Analyst layer (I3-3) — types.
//
// Insight modules receive CANONICAL data (via the existing read-only
// StructuredQueryContext) and return DETERMINISTIC STRUCTURED FINDINGS —
// never formatted text. Formatting/localization happens exclusively in the
// presenter (formatFindings / explanationLayer). No LLM, no approximations,
// no fabricated explanations: a finding exists only when its numbers are
// mathematically available from canonical outputs.
// ============================================================

import type { BusinessMetric } from '../language/types';
import type { StructuredQuerySourceKind, StructuredValueKind } from '../query/types';

export type InsightSeverity = 'critical' | 'warning' | 'opportunity' | 'positive' | 'information';

/** Deterministic rank for priority ordering (lower = more urgent). */
export const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0, warning: 1, opportunity: 2, positive: 3, information: 4,
};

export type InsightFindingKind =
  // trends / contributors
  | 'metric_trend'
  | 'top_positive_contributor'
  | 'top_negative_contributor'
  // anomalies
  | 'sales_below_rolling_average'
  | 'margin_drop'
  | 'carrier_disappeared'
  | 'employee_unusually_low'
  | 'product_stopped_selling'
  | 'large_refund_period'
  // customer patterns
  | 'customer_high_value'
  | 'customer_frequent'
  | 'customer_returning_after_absence'
  | 'customer_declining'
  | 'customer_inactive'
  | 'customer_lost'
  // employee patterns
  | 'employee_best_revenue'
  | 'employee_best_profit'
  | 'employee_best_margin'
  | 'employee_most_repairs'
  | 'employee_most_unlocks'
  | 'employee_highest_avg_ticket'
  | 'employee_attribution_incomplete'
  // carrier analysis
  | 'carrier_fastest_growing'
  | 'carrier_declining'
  | 'carrier_highest_profit'
  | 'carrier_highest_revenue'
  | 'carrier_highest_transactions'
  | 'carrier_attribution_mixed'
  // service mix
  | 'service_growth'
  | 'service_decline'
  | 'service_share';

/** A single deterministic finding. STRUCTURED DATA ONLY — the presenter
 *  renders localized text from `kind` + `data`; modules never format. */
export interface InsightFinding {
  /** Deterministic id: `${kind}:${key}` — stable across runs on same data. */
  id: string;
  kind: InsightFindingKind;
  severity: InsightSeverity;
  /** 0..1 — deterministic rule confidence (e.g. sample-size based). */
  confidence: number;
  source: StructuredQuerySourceKind;
  relatedMetrics: BusinessMetric[];
  dateRange: { startYMD: string; endYMD: string };
  /** Primary magnitude in the metric's unit (cents/count/pp) — used for
   *  deterministic ordering inside a severity band. */
  magnitude: number;
  /** Typed payload — labels, amounts (cents), percentages, counts. */
  data: Record<string, string | number | boolean | null>;
}

// ── trend ───────────────────────────────────────────────────
export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendResult {
  metric: BusinessMetric;
  kind: StructuredValueKind;
  current: number;
  previous: number;
  deltaAmount: number;
  /** % change vs previous; null when baseline is zero. */
  percentChange: number | null;
  /** percentage-POINT delta for percentage-kind metrics. */
  percentagePointDelta: number | null;
  direction: TrendDirection;
  /** false when either side is a non-meaningful margin. */
  meaningful: boolean;
  currentRange: { startYMD: string; endYMD: string };
  previousRange: { startYMD: string; endYMD: string };
}

// ── contributors ────────────────────────────────────────────
export interface ContributorDelta {
  label: string;
  dimension: 'category' | 'payment_provider';
  currentCents: number;
  previousCents: number;
  deltaCents: number;
}

export interface ContributorAnalysis {
  metric: BusinessMetric;
  /** Sorted by delta desc (largest increase first). */
  positive: ContributorDelta[];
  /** Sorted by delta asc (largest decline first). */
  negative: ContributorDelta[];
}

// ── suggested questions (Part 11 — deterministic rule engine) ──
export interface SuggestedQuestion {
  /** Ready-to-send localized question text. */
  text: string;
  /** The finding that produced it. */
  sourceFindingId: string;
}

// ── visual cards (Part 12 — typed API only, NO UI) ──────────
export type InsightCardKind =
  | 'revenue_card' | 'profit_card' | 'trend_card'
  | 'customer_alert' | 'inventory_alert' | 'opportunity_card';

export interface InsightCard {
  kind: InsightCardKind;
  severity: InsightSeverity;
  /** Headline metric value in cents/count/pp per valueKind. */
  value: number;
  valueKind: StructuredValueKind;
  trend?: TrendResult;
  findingIds: string[];
  dateRange: { startYMD: string; endYMD: string };
  data: Record<string, string | number | boolean | null>;
}

export interface BusinessInsightsResult {
  findings: InsightFinding[];
  cards: InsightCard[];
  suggestions: SuggestedQuestion[];
  generatedForRange: { startYMD: string; endYMD: string };
}
