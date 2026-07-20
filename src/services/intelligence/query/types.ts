// ============================================================
// CellHub Intelligence — Structured Business Query Executor (I3-2) — types.
//
// The executor turns a ParsedBusinessQuery into a canonical, deterministic
// answer. ALL authoritative money comes from computeReportMoneyStats /
// customerMoneyProfile — the executor SCOPES records and READS canonical
// outputs; it never re-implements a financial formula. Read-only: it mutates
// nothing. No `any`.
// ============================================================

import type { ParsedBusinessQuery, BusinessMetric, BusinessDimension } from '../language/types';
import type { LocalDayRange } from '@/utils/reportRange';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { CanonicalMoneySnapshot } from '../adapters/reportMoneyAdapter';
import type { CustomerMoneyProfile } from '@/services/customers/customerMoneyProfile';
import type { CustomerHistorySummary } from '../types';

export type StructuredQueryStatus =
  | 'answered'
  | 'no_data'
  | 'unsupported'
  | 'ambiguous'
  | 'not_found'
  | 'error';

/** TYPED reason for a recognized-but-blocked query. The live gate turns these
 *  into TERMINAL localized responses — a confidently recognized financial
 *  question must never fall through to a legacy financial handler. Decisions
 *  are made on this type, never on diagnostic strings. */
export type StructuredUnsupportedReason =
  | 'unsupported_metric_dimension'
  | 'mixed_carrier_attribution'
  | 'employee_attribution_incomplete'
  | 'store_comparison_unavailable'
  | 'return_count_unavailable'
  | 'invalid_date_range'
  | 'missing_comparison_operand'
  | 'incompatible_dimensions'
  // CHAT-R1.1: a RECOGNIZED structured query hit an internal failure (or an
  // empty presentation) after recognition — terminal honest unavailability,
  // never a silent legacy fallback with a different period/meaning.
  | 'structured_engine_unavailable';

/** Support level for a metric/dimension pair (Part J matrix). */
export type SupportLevel =
  | 'exact_supported'
  | 'exact_supported_with_condition'
  | 'unsupported_exactness'
  | 'unavailable_context';

export type StructuredQuerySourceKind =
  | 'canonical_report_money'
  | 'canonical_customer_money'
  | 'operational_count'
  | 'legacy_fallback';

export type StructuredValueKind = 'money_cents' | 'count' | 'percentage' | 'text';

export interface StructuredScalarValue {
  kind: StructuredValueKind;
  /** money in integer cents; counts as integers; percentages as e.g. 12.5. */
  amount: number;
  meaningful: boolean;    // margin-style values may be non-meaningful
}

export interface StructuredQueryRow {
  label: string;          // display label (entity/category/employee/…)
  value: StructuredScalarValue;
  /** stable secondary key for deterministic ties (canonical id or name). */
  tieKey: string;
  /** Canonical FINANCIAL transaction count (customer rows) — rendered as
   *  localized "transactions", never "visits"/"interactions". */
  txCount?: number;
}

export interface StructuredComparisonResult {
  leftLabel: string;
  rightLabel: string;
  left: StructuredScalarValue;
  right: StructuredScalarValue;
  deltaAmount: number;              // left − right, same unit as values
  /** % change vs right/baseline; undefined when baseline is zero/not meaningful. */
  percentChange?: number;
  /** percentage-POINT difference for margin comparisons. */
  percentagePointDelta?: number;
}

export interface ResolvedBusinessDateRange {
  range: LocalDayRange;
  /** i18n-resolved label key data (kind or explicit dates). */
  labelKind: string;      // 'today' | … | 'custom' | 'last_30_days'
  startYMD: string;
  endYMD: string;
  /** true when the product default (last_30_days) was applied. */
  defaulted: boolean;
}

export interface StructuredQueryDiagnostics {
  reason?: string;
  excludedMixedCarrierSales?: number;
  candidates?: string[];
}

export interface StructuredBusinessQueryResult {
  status: StructuredQueryStatus;
  parsed: ParsedBusinessQuery;
  answer?: string;
  resolvedRange?: ResolvedBusinessDateRange;
  value?: StructuredScalarValue;
  rows?: StructuredQueryRow[];
  comparisonResult?: StructuredComparisonResult;
  sourceKinds: StructuredQuerySourceKind[];
  /** Present on unsupported/ambiguous — the TYPED terminal reason. */
  unsupportedReason?: StructuredUnsupportedReason;
  diagnostics?: StructuredQueryDiagnostics;
}

/** Read-only execution context supplied by the engine. NO mutation methods. */
export interface StructuredQueryContext {
  /** RAW store-scoped snapshot (same collections Reports reads). */
  snapshot: CanonicalMoneySnapshot;
  /** Canonical projection for a range over the FULL snapshot. */
  computeForRange(range: LocalDayRange): ReportMoneyStats;
  /** Canonical projection for a range over a SCOPED (filtered) snapshot —
   *  scoping selects records; money math stays canonical. */
  computeForScopedSnapshot(partial: Partial<CanonicalMoneySnapshot>, range: LocalDayRange): ReportMoneyStats;
  /** Batched canonical customer profiles (existing engine provider). */
  getCustomerValueProfiles(): Map<string, CustomerMoneyProfile>;
  getTopCustomersByValue(limit: number): Array<{
    customerId: string; name: string; revenueCents: number; profitCents: number;
    marginPercent: number; marginMeaningful: boolean; transactionCount: number;
    netAfterReturnsCents: number;
  }>;
  getCustomerHistory(customerId: string): CustomerHistorySummary | null;
  customers: Array<{ id: string; name: string; phone?: string }>;
  employees: Array<{ id?: string; name: string }>;
  storeId?: string;
  referenceDate: Date;
}

export type { ParsedBusinessQuery, BusinessMetric, BusinessDimension };
