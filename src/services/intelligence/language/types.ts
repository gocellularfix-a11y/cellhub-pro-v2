// ============================================================
// CellHub Business Language Engine — types (CELLHUB-INTELLIGENCE-I3-1)
//
// The FOUNDATION contract: a deterministic parser that DESCRIBES a business
// question. It never calculates money — a later canonical executor (I3-2)
// consumes ParsedBusinessQuery and produces answers. No `any`, no money.
// ============================================================

/** UI/answer languages, matching the rest of Intelligence (Lang3). */
export type BusinessLanguage = 'en' | 'es' | 'pt';

/** What the user is asking the system to DO. */
export type BusinessIntent =
  | 'get_metric'          // "how much profit today"
  | 'compare_metric'      // "compare this month vs last month"
  | 'rank_dimension'      // "which carrier sold the most"
  | 'summarize_dimension' // "sales by category"
  | 'find_customer'       // "find customer Jenny"
  | 'unknown';

/** Canonical metric NAMES (not values). Aligned to the canonical money
 *  service + customer money profile so the future executor can map 1:1. */
export type BusinessMetric =
  | 'gross_sales'
  | 'returns'
  | 'net_sales'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'gross_tax'
  | 'net_tax'
  | 'cash'
  | 'card'
  | 'store_credit'
  | 'transaction_count'
  | 'average_ticket'
  | 'total_collected'
  | 'commissionable_revenue'
  | 'customer_profit'
  | 'customer_margin'
  | 'interactions';

/** A dimension to rank/summarize/break down by. carrier and payment_provider
 *  are DELIBERATELY distinct concepts (never interchangeable). */
export type BusinessDimension =
  | 'carrier'
  | 'payment_provider'
  | 'category'
  | 'employee'
  | 'customer'
  | 'product'
  | 'service'
  | 'payment_method'
  | 'store';

export type DateRangeKind =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom'
  | 'all_time';

/** Parsed date range. For 'custom', startDate/endDate are ISO local calendar
 *  days (YYYY-MM-DD) — NO time, NO UTC assumption. The executor turns these
 *  into a canonical LocalDayRange; the language module never does money math. */
export interface ParsedDateRange {
  kind: DateRangeKind;
  startDate?: string;   // YYYY-MM-DD (custom only)
  endDate?: string;     // YYYY-MM-DD (custom only)
}

export type BusinessComparison =
  | 'highest'
  | 'lowest'
  | 'increase'
  | 'decrease'
  | 'versus_previous_period'
  | 'between_periods'
  | 'between_metrics'    // I3-1.1: "cash versus card"
  | 'between_entities';  // I3-1.1: "AT&T versus Verizon"

/** I3-1.1: one side of a two-operand comparison. The executor treats the two
 *  operands as authoritative for between_metrics / between_entities /
 *  between_periods. No money — describes the operand only. */
export interface BusinessQueryOperand {
  metric?: BusinessMetric;
  dimension?: BusinessDimension;
  entity?: RecognizedEntity;
  dateRange?: ParsedDateRange;
}

/** A recognized entity reference. rawText is always present; canonicalId/
 *  canonicalName are filled when a RUNTIME entity (supplied by the caller)
 *  resolves — the parser itself hardcodes no store data. */
export interface RecognizedEntity {
  type: BusinessDimension | 'unknown';
  canonicalId?: string;
  canonicalName?: string;
  rawText: string;
}

/** THE structured result. Describes the question; computes nothing. */
export interface ParsedBusinessQuery {
  intent: BusinessIntent;
  metric?: BusinessMetric;
  dimension?: BusinessDimension;
  dateRange?: ParsedDateRange;
  comparison?: BusinessComparison;
  /** I3-1.1: two-operand comparison (between_metrics / between_entities /
   *  between_periods). Present only for those comparison kinds; operands are
   *  authoritative for the executor. */
  comparisonOperands?: { left: BusinessQueryOperand; right: BusinessQueryOperand };
  entity?: RecognizedEntity;
  sourceLanguage: BusinessLanguage;
  normalizedText: string;
  confidence: number;        // 0..1
  assumptions: string[];     // interpretation choices the executor should surface
  ambiguities: string[];     // unresolved ambiguity the executor may clarify
  matchedTerms: string[];    // dictionary terms that fired (diagnostics)
}

/** A runtime entity the caller supplies (configured carriers, providers,
 *  employees, categories, stores, customers). Lets the executor inject store
 *  data WITHOUT modifying the parser. */
export interface RuntimeEntity {
  id?: string;
  name: string;
  aliases?: string[];
}

/** Runtime entity sets, all optional — the parser resolves against whatever
 *  is supplied and otherwise leaves entities unresolved (rawText only). */
export interface RuntimeEntitySet {
  carriers?: RuntimeEntity[];
  paymentProviders?: RuntimeEntity[];
  employees?: RuntimeEntity[];
  categories?: RuntimeEntity[];
  stores?: RuntimeEntity[];
  customers?: RuntimeEntity[];
  products?: RuntimeEntity[];
}

export interface ParseBusinessQueryOptions {
  /** Force the source language; when omitted the parser detects it. */
  language?: BusinessLanguage;
  /** Reference "now" for resolving custom date years (default: new Date()). */
  referenceDate?: Date;
  /** Runtime entities to resolve against (configured store data). */
  entities?: RuntimeEntitySet;
}

/** Deterministic normalization output. `original` is preserved verbatim. */
export interface NormalizedBusinessText {
  original: string;
  /** lowercased, apostrophes/quotes unified, currency stripped, whitespace collapsed. */
  normalized: string;
  /** normalized + accents folded (á→a, ç→c, ñ→n) — used for matching. */
  folded: string;
  /** folded + controlled business-typo corrections applied. */
  corrected: string;
}
