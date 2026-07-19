// ============================================================
// Business Analyst — findings engine (I3-3 Part 3).
//
// Orchestrates every insight module over one canonical range, then orders
// findings deterministically by priority: severity rank → magnitude desc →
// id asc. Adds the headline metric trends as findings. No text generation.
// ============================================================

import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import type { BusinessMetric } from '../language/types';
import { computeMetricTrend } from './trendAnalysis';
import { detectAnomalies } from './anomalyDetection';
import { detectCustomerPatterns } from './customerPatterns';
import { analyzeEmployees } from './employeePatterns';
import { analyzeCarriers } from './carrierAnalysis';
import { analyzeServiceMix } from './serviceAnalysis';
import { SEVERITY_RANK } from './types';
import type { InsightFinding, InsightSeverity } from './types';

const HEADLINE_METRICS: readonly BusinessMetric[] = ['gross_sales', 'profit', 'margin'];

function trendSeverity(direction: 'up' | 'down' | 'flat'): InsightSeverity {
  return direction === 'up' ? 'positive' : direction === 'down' ? 'warning' : 'information';
}

export function sortFindings(findings: InsightFinding[]): InsightFinding[] {
  return [...findings].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || b.magnitude - a.magnitude
    || a.id.localeCompare(b.id));
}

export function collectBusinessFindings(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange): InsightFinding[] {
  const findings: InsightFinding[] = [];

  // Headline trends (Part 4) as findings.
  for (const metric of HEADLINE_METRICS) {
    const t = computeMetricTrend(ctx, metric, range);
    if (!t || !t.meaningful) continue;
    if (t.current === 0 && t.previous === 0) continue;
    findings.push({
      id: `metric_trend:${metric}`, kind: 'metric_trend',
      severity: trendSeverity(t.direction), confidence: 1,
      source: 'canonical_report_money', relatedMetrics: [metric],
      dateRange: t.currentRange, magnitude: Math.abs(t.deltaAmount),
      data: {
        metric, current: t.current, previous: t.previous, deltaAmount: t.deltaAmount,
        percentChange: t.percentChange, percentagePointDelta: t.percentagePointDelta, direction: t.direction,
      },
    });
  }

  findings.push(...detectAnomalies(ctx, range));
  findings.push(...detectCustomerPatterns(ctx));
  findings.push(...analyzeEmployees(ctx, range));
  findings.push(...analyzeCarriers(ctx, range));
  findings.push(...analyzeServiceMix(ctx, range));

  // Deterministic dedup by id (later modules never overwrite earlier ones).
  const seen = new Set<string>();
  const unique = findings.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  return sortFindings(unique);
}
