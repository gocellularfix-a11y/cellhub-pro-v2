// ============================================================
// Structured Business Query Executor (I3-2) — public surface.
// ============================================================

export type {
  StructuredBusinessQueryResult, StructuredQueryStatus, StructuredQuerySourceKind,
  StructuredScalarValue, StructuredQueryRow, StructuredComparisonResult,
  ResolvedBusinessDateRange, StructuredQueryContext,
} from './types';

export { executeBusinessQuery, STRUCTURED_QUERY_MIN_CONFIDENCE } from './executeBusinessQuery';
export { formatBusinessQueryAnswer, metricLabel, rangeLabel } from './formatBusinessQueryAnswer';
export { resolveBusinessDateRange, derivePreviousPeriod } from './resolveBusinessDateRange';
export { buildRuntimeEntitySet } from './buildRuntimeEntitySet';
export { tryHandleStructuredBusinessQuery } from './tryHandleStructuredBusinessQuery';
export { setAnalyticalContext, getAnalyticalContext, clearAnalyticalContext, mergeFollowUp } from './analyticalContext';
export { METRIC_REGISTRY } from './canonicalMetricRegistry';
