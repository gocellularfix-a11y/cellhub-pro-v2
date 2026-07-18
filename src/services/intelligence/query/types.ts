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
