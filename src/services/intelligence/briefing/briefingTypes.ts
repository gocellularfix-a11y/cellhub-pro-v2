// CellHub Intelligence — Canonical Briefing Types
// R-INTELLIGENCE-MERGE-BRIEFING-SYSTEMS-V1
//
// ─── PROBLEM ──────────────────────────────────────────────────────────────────
//
// 14 systems generate "what should I do today" recommendations independently.
// The same data (stale repair, dead stock, VIP outreach) surfaces on multiple
// screens simultaneously with different priority words, different thresholds,
// and no cross-system deduplication.
//
// ─── OVERLAP / CONFLICT MAP ───────────────────────────────────────────────────
//
// SIGNAL          DETECTED BY (THRESHOLD)                          RISK
// ─────────────── ──────────────────────────────────────────────── ────────────
// Stale repairs   dailyBriefing (2d+), operator/dailyBrief (3d+),  7 surfaces,
//                 handleProactiveOpportunities (3d+),              3 different
//                 handleTodayMoneyMap (3d+),                       thresholds
//                 handleOperatorMode (3d+),
//                 revenueOpportunityEngine detectDelayedRepairs (5d+),
//                 moduleWideOpportunityDetectors repair_ready (2d+)
//
// Dead stock      operator/dailyBrief (≥$100), handleProactiveOpps (≥$100),    7 surfaces,
//                 handleTodayMoneyMap, handleOperatorMode,         1 threshold
//                 handleDailyRevenueMissions,
//                 revenueOpportunityEngine detectDeadStock (60d+ no sale),
//                 moduleWideOpportunityDetectors inventory.deadstock
//
// Customer        dailyBriefing, operator/dailyBrief (≥2 candidates),           8 surfaces,
// outreach        handleProactiveOpps (≥2), handleTodayMoneyMap,  varies
//                 handleOperatorMode, handleDailyRevenueMissions,
//                 revenueOpportunityEngine detectInactiveCustomers/detectVipRetention,
//                 moduleWideOpportunityDetectors customer.vip
//
// Pending deals   handleTodayMoneyMap (×2000), handleOperatorMode (×2000),      4 surfaces,
//                 handleProactiveOpps (×800),  same raw data
//                 handleDailyRevenueMissions
//
// Unpaid balances dailyBriefing (collections), revenueOpportunityEngine,        4 surfaces
//                 moduleWideOpportunityDetectors customer.unpaid,
//                 morningDigest (recoverable money section)
//
// ─── PRIORITY CONFLICT ────────────────────────────────────────────────────────
//
//  SAME stale repair surfaced as:
//    dailyBriefing    → "attention" severity
//    operator brief   → "high" severity
//    handleMoneyMap   → rank #1 (cents + count*1500)
//    revenueEngine    → priority ~70
//    moduleWide       → "high" severity
//  Different words, different relative positions. No shared dedup.
//
// ─── THIS FILE ────────────────────────────────────────────────────────────────
//
// Defines a canonical IntelligenceBrief envelope that any existing system can
// adapt to. Does NOT replace or modify existing systems. Helpers in
// briefingHelpers.ts are pure (no I/O). One low-risk wiring in dailyBriefing.ts.
//
// ─── MIGRATION PATH ───────────────────────────────────────────────────────────
//
// Phase 1 (done): types + helpers + dailyBriefing adapter
// Phase 2: adapt operator/dailyBrief.ts DailyOperatorBrief → IntelligenceBrief
//   DailyBriefPriority.severity maps 1:1 to BriefSeverity (same words)
// Phase 3: adapt revenueOpportunityEngine → IntelligenceBrief
//   RevenueOpportunity.priority (0-100) maps directly to BriefItem.priority
// Phase 4: adapt moduleWideOpportunityService → IntelligenceBrief
//   Already has computeModuleOpportunitiesForRegistry() from registry round
// Phase 5: add cross-system dedup in a new aggregator function
//   Call dedupeBriefItems() across all adapted sources → single merged brief
// Phase 6: surface unified IntelligenceBrief in UI (replaces ad-hoc lists)

// ── Severity ──────────────────────────────────────────────────────────────────

/** Unified severity scale covering all existing systems. */
export type BriefSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ── Source ────────────────────────────────────────────────────────────────────

/** Identifies which system produced a BriefItem. */
export type BriefSource =
  | 'daily_briefing'       // briefing/dailyBriefing.ts
  | 'operator_brief'       // operator/dailyBrief.ts
  | 'proactive_opps'       // handlers.ts handleProactiveOpportunities
  | 'today_money_map'      // handlers.ts handleTodayMoneyMap
  | 'operator_mode'        // handlers.ts handleOperatorMode
  | 'revenue_missions'     // handlers.ts handleDailyRevenueMissions
  | 'module_wide'          // moduleWideOpportunities/
  | 'revenue_signals'      // revenueOpportunities/
  | 'continuity'           // continuity/continuityEngine.ts
  | 'context_suggestions'  // liveContext/contextSuggestions.ts
  | 'weekly_review'        // review/weeklyOperatorReview.ts
  | 'morning_digest';      // digest/morningDigest.ts

// ── Category ──────────────────────────────────────────────────────────────────

/** Normalized category covering all existing BriefingCategory / module values. */
export type BriefItemCategory =
  | 'sales'
  | 'repairs'
  | 'collections'
  | 'customers'
  | 'inventory'
  | 'deals'
  | 'operations'
  | 'continuity'
  | 'review';

// ── Core canonical types ──────────────────────────────────────────────────────

/**
 * Canonical brief item — the atomic unit of an IntelligenceBrief.
 * Produced by normalizeBriefItem() in briefingHelpers.ts.
 */
export interface BriefItem {
  /** Deterministic ID: `brief:{source}:{category}:{entityId|global}` */
  id: string;
  category: BriefItemCategory;
  severity: BriefSeverity;
  /** 0–100 unified priority. Higher surfaces first. Maps from severity by default. */
  priority: number;
  /** Human-readable title (one sentence). */
  title: string;
  /** Supporting detail or metric (e.g. "$150", "3 items"). */
  summary?: string;
  suggestedAction?: string;
  source: BriefSource;
  entityType?: 'customer' | 'repair' | 'inventory' | 'layaway' | 'deal';
  entityId?: string;
  estimatedValueCents?: number;
  detectedAt: number;
}

/**
 * A cluster of BriefItems at the same severity level.
 * For grouped UI rendering (critical section, high section, etc.).
 */
export interface BriefPriority {
  severity: BriefSeverity;
  /** 0–100 representative priority for the tier. */
  priority: number;
  items: BriefItem[];
}

/**
 * Full canonical brief — the output of a briefing aggregator.
 * Built by generateDailyBriefAsCanonical() or a future cross-system aggregator.
 */
export interface IntelligenceBrief {
  generatedAt: number;
  /** All brief items, sorted by priority descending. */
  items: BriefItem[];
  /** Highest-priority item (items[0]). */
  topPriority?: BriefItem;
  /** Which sources contributed to this brief. */
  sources: BriefSource[];
}
