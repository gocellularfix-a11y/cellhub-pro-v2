// ============================================================
// Business Analyst layer (I3-3) — public surface.
// ============================================================

export type {
  InsightSeverity, InsightFindingKind, InsightFinding,
  TrendResult, TrendDirection, ContributorAnalysis, ContributorDelta,
  SuggestedQuestion, InsightCard, InsightCardKind, BusinessInsightsResult,
} from './types';
export { SEVERITY_RANK } from './types';

export { computeMetricTrend } from './trendAnalysis';
export { computeContributors } from './contributorAnalysis';
export {
  detectAnomalies, ROLLING_AVERAGE_PERIODS, LOW_SALES_RATIO, MARGIN_DROP_PP,
  EMPLOYEE_LOW_RATIO, LARGE_REFUND_SHARE,
} from './anomalyDetection';
export {
  detectCustomerPatterns, FREQUENT_MIN_TX, FREQUENT_MAX_AVG_DAYS,
  INACTIVE_DAYS, LOST_DAYS, RETURNING_ABSENCE_DAYS, HIGH_VALUE_TOP_N, DECLINING_GAP_FACTOR,
} from './customerPatterns';
export { analyzeEmployees } from './employeePatterns';
export { analyzeCarriers } from './carrierAnalysis';
export { analyzeServiceMix, SERVICE_TREND_MIN_PCT } from './serviceAnalysis';
export { collectBusinessFindings, sortFindings } from './findingsEngine';
export { suggestQuestions, MAX_SUGGESTIONS } from './suggestedQuestions';
export { buildInsightCards } from './insightCards';
export { buildAnswerExplanation, formatTrendLine } from './explanationLayer';
export { formatFinding, formatFindings } from './formatFindings';
