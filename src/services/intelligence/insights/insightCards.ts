// ============================================================
// Business Analyst — visual card structures (I3-3 Part 12).
//
// TYPED DATA API ONLY — no UI is built here. Cards are deterministic
// projections of findings + trends for a future dashboard surface.
// ============================================================

import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import { computeMetricTrend } from './trendAnalysis';
import type { InsightFinding, InsightCard, InsightSeverity } from './types';
import { SEVERITY_RANK } from './types';

function worst(findings: InsightFinding[]): InsightSeverity {
  return findings.reduce<InsightSeverity>((acc, f) =>
    (SEVERITY_RANK[f.severity] < SEVERITY_RANK[acc] ? f.severity : acc), 'information');
}

export function buildInsightCards(
  ctx: StructuredQueryContext,
  range: ResolvedBusinessDateRange,
  findings: InsightFinding[],
): InsightCard[] {
  const cards: InsightCard[] = [];
  const dateRange = { startYMD: range.startYMD, endYMD: range.endYMD };
  const stats = ctx.computeForRange(range.range);
  const byKind = (kinds: InsightFinding['kind'][]) => findings.filter((f) => kinds.includes(f.kind));

  // Revenue card — canonical gross + trend.
  const revTrend = computeMetricTrend(ctx, 'gross_sales', range);
  cards.push({
    kind: 'revenue_card', severity: revTrend?.direction === 'down' ? 'warning' : 'positive',
    value: stats.grossSalesCents, valueKind: 'money_cents', trend: revTrend ?? undefined,
    findingIds: byKind(['metric_trend', 'sales_below_rolling_average']).map((f) => f.id),
    dateRange, data: { netSalesCents: stats.netSalesCents, txCount: stats.txCount },
  });

  // Profit card — canonical profit + margin (only meaningful margins).
  const profitTrend = computeMetricTrend(ctx, 'profit', range);
  cards.push({
    kind: 'profit_card', severity: profitTrend?.direction === 'down' ? 'warning' : 'positive',
    value: stats.totalProfitCents, valueKind: 'money_cents', trend: profitTrend ?? undefined,
    findingIds: byKind(['metric_trend', 'margin_drop']).map((f) => f.id),
    dateRange, data: { marginPct: stats.profitMarginMeaningful ? stats.profitMargin : null, marginMeaningful: stats.profitMarginMeaningful },
  });

  // Trend card — the largest headline movement.
  const trendFindings = byKind(['metric_trend']);
  if (trendFindings.length > 0) {
    const lead = trendFindings[0];
    cards.push({
      kind: 'trend_card', severity: lead.severity, value: Math.abs(Number(lead.data.deltaAmount) || 0),
      valueKind: lead.data.percentagePointDelta !== null && lead.data.percentagePointDelta !== undefined ? 'percentage' : 'money_cents',
      findingIds: [lead.id], dateRange, data: lead.data,
    });
  }

  // Customer alert — lost/declining/returning customers.
  const customerAlerts = byKind(['customer_lost', 'customer_declining', 'customer_returning_after_absence']);
  if (customerAlerts.length > 0) {
    cards.push({
      kind: 'customer_alert', severity: worst(customerAlerts), value: customerAlerts.length, valueKind: 'count',
      findingIds: customerAlerts.map((f) => f.id), dateRange, data: { count: customerAlerts.length },
    });
  }

  // Inventory alert — products that stopped selling.
  const inventoryAlerts = byKind(['product_stopped_selling']);
  if (inventoryAlerts.length > 0) {
    cards.push({
      kind: 'inventory_alert', severity: 'information', value: inventoryAlerts.length, valueKind: 'count',
      findingIds: inventoryAlerts.map((f) => f.id), dateRange, data: { count: inventoryAlerts.length },
    });
  }

  // Opportunity card — opportunity-severity findings.
  const opportunities = findings.filter((f) => f.severity === 'opportunity');
  if (opportunities.length > 0) {
    cards.push({
      kind: 'opportunity_card', severity: 'opportunity', value: opportunities.length, valueKind: 'count',
      findingIds: opportunities.map((f) => f.id), dateRange, data: { count: opportunities.length },
    });
  }

  return cards;
}
