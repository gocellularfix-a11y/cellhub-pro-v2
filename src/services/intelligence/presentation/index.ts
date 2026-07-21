// ============================================================
// I6-C1 — Unified presentation layer — public surface.
//
// Consumers import from here ONLY. The single canonical way to turn proactive
// insights into owner-facing, ready-to-render models.
// ============================================================

export type {
  PresenterLang, InsightPriority, InsightActionHint,
  InsightCard, InsightGroup, ExecutivePresentation, PresentedInsights,
} from './types';

export { presentProactiveInsights } from './presenter';

// Stage-level exports (consumers rarely need these directly, but they keep
// the pipeline testable and let a future surface compose a custom view).
export { priorityOf, priorityRank, compareCards, orderCards } from './priority';
export { buildInsightCard } from './cardFactory';
export { composeRecommendation } from './recommendation';
export { applySuppression, groupCards } from './grouping';
export { buildExecutiveSummary } from './executiveSummary';
export {
  tri, formatMoney, formatSignedPct, formatSharePct, formatPoints, formatYMD, formatCount,
} from './strings';
