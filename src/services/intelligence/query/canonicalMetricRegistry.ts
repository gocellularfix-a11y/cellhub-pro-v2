// ============================================================
// Structured Query Executor — canonical metric registry (I3-2).
//
// ONE typed registry mapping each BusinessMetric to its canonical extractor
// over ReportMoneyStats (exact repository field names — no re-derived math).
// Money stays in integer cents until formatting. Margin uses the canonical
// profitMarginMeaningful flag — a non-meaningful margin is never presented as
// 0%. average_ticket uses the approved POS-only population: the extractor
// receives a POS-ONLY canonical projection (snapshot scoped to sales only —
// scoping, not math) so standalone repairs/unlocks never inflate it.
// ============================================================

import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { BusinessMetric } from '../language/types';
import type { StructuredScalarValue, StructuredValueKind } from './types';

export interface MetricSources {
  /** Canonical stats over the (possibly scoped) snapshot for the range. */
  stats: ReportMoneyStats;
  /** Canonical stats over the SALES-ONLY snapshot (POS population) for the
   *  same range — used exclusively by average_ticket. */
  posOnlyStats: ReportMoneyStats;
}

export interface MetricDefinition {
  metric: BusinessMetric;
  kind: StructuredValueKind;
  /** True when the metric is customer-scoped (executed via customer profiles,
   *  not ReportMoneyStats). */
  customerScoped?: boolean;
  extract?: (s: MetricSources) => StructuredScalarValue;
}

const money = (amount: number): StructuredScalarValue => ({ kind: 'money_cents', amount, meaningful: true });
const count = (amount: number): StructuredScalarValue => ({ kind: 'count', amount, meaningful: true });

export const METRIC_REGISTRY: Record<BusinessMetric, MetricDefinition> = {
  gross_sales: { metric: 'gross_sales', kind: 'money_cents', extract: ({ stats }) => money(stats.grossSalesCents) },
  net_sales: { metric: 'net_sales', kind: 'money_cents', extract: ({ stats }) => money(stats.netSalesCents) },
  returns: { metric: 'returns', kind: 'money_cents', extract: ({ stats }) => money(stats.returnAndRefundAdjustmentsCents) },
  cost: { metric: 'cost', kind: 'money_cents', extract: ({ stats }) => money(stats.totalCostCents) },
  profit: { metric: 'profit', kind: 'money_cents', extract: ({ stats }) => money(stats.totalProfitCents) },
  margin: {
    metric: 'margin', kind: 'percentage',
    extract: ({ stats }) => ({ kind: 'percentage', amount: stats.profitMargin, meaningful: stats.profitMarginMeaningful }),
  },
  gross_tax: { metric: 'gross_tax', kind: 'money_cents', extract: ({ stats }) => money(stats.grossTaxCollectedCents) },
  net_tax: { metric: 'net_tax', kind: 'money_cents', extract: ({ stats }) => money(stats.netTaxCents) },
  cash: { metric: 'cash', kind: 'money_cents', extract: ({ stats }) => money(stats.cashCents) },
  card: { metric: 'card', kind: 'money_cents', extract: ({ stats }) => money(stats.cardCents) },
  store_credit: { metric: 'store_credit', kind: 'money_cents', extract: ({ stats }) => money(stats.storeCreditCents) },
  transaction_count: { metric: 'transaction_count', kind: 'count', extract: ({ stats }) => count(stats.txCount) },
  average_ticket: {
    metric: 'average_ticket', kind: 'money_cents',
    // Approved POS-only population: canonical gross of the sales-only snapshot
    // ÷ canonical txCount (same POS population both sides — I2B-2.3 semantics).
    extract: ({ posOnlyStats }) => {
      const tx = posOnlyStats.txCount;
      return { kind: 'money_cents', amount: tx > 0 ? Math.round(posOnlyStats.grossSalesCents / tx) : 0, meaningful: tx > 0 };
    },
  },
  // Customer-scoped metrics — executed via canonical customer profiles.
  total_collected: { metric: 'total_collected', kind: 'money_cents', customerScoped: true },
  commissionable_revenue: { metric: 'commissionable_revenue', kind: 'money_cents', customerScoped: true },
  customer_profit: { metric: 'customer_profit', kind: 'money_cents', customerScoped: true },
  customer_margin: { metric: 'customer_margin', kind: 'percentage', customerScoped: true },
  // interactions (7-domain activity) has no canonical single provider outside
  // the Customer 360 UI — unsupported rather than approximated.
  interactions: { metric: 'interactions', kind: 'count', customerScoped: true },
};
