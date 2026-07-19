// ============================================================
// Business Analyst — trend analysis (I3-3 Part 4).
//
// Current period vs the immediately preceding equivalent period (same
// inclusive local-day length — today vs yesterday, week vs previous week,
// month-to-date vs preceding equal days, custom vs previous equivalent).
// ALL values come from canonical projections via the query context; this
// module only computes unit-level deltas/percentages (same rules as the
// executor's compare(): % only with nonzero baseline, pp for percentages).
// ============================================================

import type { BusinessMetric } from '../language/types';
import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import { derivePreviousPeriod } from '../query/resolveBusinessDateRange';
import { METRIC_REGISTRY } from '../query/canonicalMetricRegistry';
import type { MetricSources } from '../query/canonicalMetricRegistry';
import { posOnlySnapshot } from '../query/scopeBusinessQueryData';
import type { TrendResult, TrendDirection } from './types';

function sourcesFor(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange): MetricSources {
  return {
    stats: ctx.computeForRange(range.range),
    posOnlyStats: ctx.computeForScopedSnapshot(posOnlySnapshot(ctx.snapshot), range.range),
  };
}

/** Canonical trend for a whole-store metric. Returns null when the metric has
 *  no canonical extractor (customer-scoped metrics need a customer context). */
export function computeMetricTrend(
  ctx: StructuredQueryContext,
  metric: BusinessMetric,
  range: ResolvedBusinessDateRange,
): TrendResult | null {
  const def = METRIC_REGISTRY[metric];
  if (!def || def.customerScoped || !def.extract) return null;

  const previousRange = derivePreviousPeriod(range);
  const current = def.extract(sourcesFor(ctx, range));
  const previous = def.extract(sourcesFor(ctx, previousRange));

  const deltaAmount = current.amount - previous.amount;
  const direction: TrendDirection = deltaAmount > 0 ? 'up' : deltaAmount < 0 ? 'down' : 'flat';
  const isPercentage = current.kind === 'percentage';
  return {
    metric,
    kind: current.kind,
    current: current.amount,
    previous: previous.amount,
    deltaAmount,
    percentChange: !isPercentage && previous.amount !== 0
      ? Math.round((deltaAmount / Math.abs(previous.amount)) * 1000) / 10
      : null,
    percentagePointDelta: isPercentage ? Math.round(deltaAmount * 10) / 10 : null,
    direction,
    meaningful: current.meaningful && previous.meaningful,
    currentRange: { startYMD: range.startYMD, endYMD: range.endYMD },
    previousRange: { startYMD: previousRange.startYMD, endYMD: previousRange.endYMD },
  };
}
