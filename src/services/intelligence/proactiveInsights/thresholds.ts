// ============================================================
// I6-0A — deterministic proactive thresholds (single source, exported).
//
// Every emitted insight echoes the NAMED thresholds applied to it, so a
// result is explainable without reading this file. Severity is BUSINESS
// IMPACT decided by these rules — never derived from confidence. Change
// ONLY with auditor approval — these values define what "material" means
// for the whole proactive layer.
// ============================================================

// ── sales momentum ──────────────────────────────────────────
/** A sales change is MATERIAL at ±20% vs baseline. */
export const SALES_MATERIAL_CHANGE_PCT = 20;

/** A decline of 40%+ is CRITICAL (still 'important' below this). */
export const SALES_CRITICAL_DECLINE_PCT = 40;

/** Baseline revenue floor ($100.00): below this, percentage changes are
 *  noise and the detector refuses to claim anything. */
export const MIN_BASELINE_REVENUE_CENTS = 10_000;

/** Each window needs at least this many canonical transactions to support
 *  a claim about the business (not about one sale). */
export const MIN_WINDOW_TRANSACTIONS = 3;

/** Insights below this evidence confidence are never emitted. */
export const MIN_CONFIDENCE = 0.5;

// ── gross margin pressure (PERCENTAGE POINTS, never relative %) ──
/** A margin move of ±5 percentage points is MATERIAL (40% → 35%). */
export const MARGIN_MATERIAL_CHANGE_POINTS = 5;

/** A margin DROP of 10+ percentage points is CRITICAL. */
export const MARGIN_CRITICAL_DROP_POINTS = 10;

/** Below this cost coverage a margin CONCLUSION is not presented as fact —
 *  the margin detector suppresses and evidence_quality owns the root cause.
 *  Matches the existing chat convention (approximate-tag under 0.7). */
export const MIN_COST_COVERAGE_FOR_MARGIN_CLAIM = 0.7;

// ── carrier concentration ───────────────────────────────────
/** Trailing full-local-day window for carrier activity. */
export const CARRIER_WINDOW_DAYS = 30;

/** Concentration at/above this share is WATCH-worthy exposure. */
export const CARRIER_HIGH_CONCENTRATION_SHARE = 0.6;

/** Concentration at/above this share is IMPORTANT exposure. */
export const CARRIER_SEVERE_CONCENTRATION_SHARE = 0.8;

/** Minimum eligible (pure single-carrier) transactions for ANY
 *  concentration claim. */
export const CARRIER_MIN_ELIGIBLE_TRANSACTIONS = 10;

// ── evidence quality ────────────────────────────────────────
/** Under this revenue-weighted cost coverage, profit-derived evidence is
 *  structurally weak (existing chat convention: unreliable under 0.5). */
export const LOW_COST_COVERAGE = 0.5;

/** Carrier-impure share (of carrier-touching sales) at/above this is
 *  excessive unknown classification. */
export const EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE = 0.2;

/** Under this share of customer-attributed sales, customer-scoped evidence
 *  is structurally missing attribution. */
export const MIN_CUSTOMER_ATTRIBUTION_SHARE = 0.2;

/** Most recent activity older than this many days before the reference
 *  date (with history present) = stale activity. */
export const STALE_ACTIVITY_DAYS = 3;

// ── engine ──────────────────────────────────────────────────
/** Hard cap of emitted insights per run (stable-sorted before capping). */
export const MAX_INSIGHTS_PER_RUN = 10;
