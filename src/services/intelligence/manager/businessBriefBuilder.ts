// ============================================================
// Business Manager — daily business brief (I4 Parts 1-2).
//
// BusinessInsightsResult → BusinessBrief. Every section is a deterministic
// projection of findings; the executive summary is built from rule templates
// over findings (structured items — text lives in the presenter). Never
// invents: no finding → no summary line.
// ============================================================

import type { BusinessInsightsResult, InsightFinding } from '../insights/types';
import type { BusinessBrief, ExecutiveSummaryItem } from './types';
import { actionsForFindings } from './actionEngine';
import { computeBusinessScore } from './businessScore';
import { computeHealthSections } from './healthEngine';
import { buildPriorityQueue } from './priorityEngine';

export const MAX_SUMMARY_ITEMS = 8;

export function buildExecutiveSummary(findings: InsightFinding[]): ExecutiveSummaryItem[] {
  const items: ExecutiveSummaryItem[] = [];

  // Headline metric directions (gross_sales → profit → margin, that order).
  for (const metric of ['gross_sales', 'profit', 'margin'] as const) {
    const f = findings.find((x) => x.kind === 'metric_trend' && x.data.metric === metric);
    if (f) {
      items.push({ kind: 'metric_direction', data: { metric, direction: String(f.data.direction) }, sourceFindingId: f.id });
    }
  }
  // Strongest carrier growth.
  const carrier = findings.find((f) => f.kind === 'carrier_fastest_growing');
  if (carrier) items.push({ kind: 'carrier_strongest_growth', data: { carrier: String(carrier.data.carrier) }, sourceFindingId: carrier.id });

  // Service movements (declines first — the manager flags problems).
  const decline = findings.find((f) => f.kind === 'service_decline');
  if (decline) items.push({ kind: 'service_declined', data: { population: String(decline.data.population) }, sourceFindingId: decline.id });
  const growth = findings.find((f) => f.kind === 'service_growth');
  if (growth) items.push({ kind: 'service_grew', data: { population: String(growth.data.population) }, sourceFindingId: growth.id });

  // Customer highlights.
  const returned = findings.find((f) => f.kind === 'customer_returning_after_absence');
  if (returned) items.push({ kind: 'customer_returned', data: { name: String(returned.data.name), absenceDays: Number(returned.data.absenceDays) }, sourceFindingId: returned.id });
  const lostCount = findings.filter((f) => f.kind === 'customer_lost').length;
  if (lostCount > 0) items.push({ kind: 'customers_lost', data: { count: lostCount } });

  if (items.length === 0) items.push({ kind: 'no_significant_changes', data: {} });
  return items.slice(0, MAX_SUMMARY_ITEMS);
}

export function buildBusinessBrief(insights: BusinessInsightsResult): BusinessBrief {
  const { findings } = insights;
  const actions = actionsForFindings(findings);
  return {
    generatedForRange: insights.generatedForRange,
    executiveSummary: buildExecutiveSummary(findings),
    criticalAlerts: findings.filter((f) => f.severity === 'critical'),
    warnings: findings.filter((f) => f.severity === 'warning'),
    opportunities: findings.filter((f) => f.severity === 'opportunity'),
    positiveHighlights: findings.filter((f) => f.severity === 'positive'),
    recommendedActions: actions,
    suggestedQuestions: insights.suggestions,
    score: computeBusinessScore(findings),
    health: computeHealthSections(findings),
    priorityQueue: buildPriorityQueue(findings, actions),
  };
}
