// ============================================================
// Business Manager — dashboard API (I4 Parts 7 + 12).
//
// Typed dashboard model built from one BusinessBrief — the first Business
// Manager screen is fully representable from this structure. NO UI here.
// ============================================================

import type { BusinessInsightsResult, InsightFinding } from '../insights/types';
import type { ManagerDashboard } from './types';
import { buildBusinessBrief } from './businessBriefBuilder';
import { HEALTH_REFUSAL_KINDS } from './healthEngine';

export const DASHBOARD_LIST_LIMIT = 5;

function isRefusal(f: InsightFinding | undefined): boolean {
  return !!f && (HEALTH_REFUSAL_KINDS as readonly string[]).includes(f.kind);
}
function isImprovement(f: InsightFinding): boolean {
  return (f.kind === 'metric_trend' && f.data.direction === 'up')
    || f.kind === 'service_growth' || f.kind === 'carrier_fastest_growing';
}
function isDecline(f: InsightFinding): boolean {
  return (f.kind === 'metric_trend' && f.data.direction === 'down')
    || f.kind === 'service_decline' || f.kind === 'carrier_declining' || f.kind === 'carrier_disappeared';
}
function isRisk(f: InsightFinding): boolean {
  // I4.1: refusal findings are DATA-QUALITY limitations, never business risks.
  return (f.severity === 'critical' || f.severity === 'warning') && !isRefusal(f);
}

export function buildManagerDashboard(insights: BusinessInsightsResult): ManagerDashboard {
  const brief = buildBusinessBrief(insights);
  const { findings } = insights;
  const byId = new Map(findings.map((f) => [f.id, f] as const));
  const top = (xs: InsightFinding[]) => xs.slice(0, DASHBOARD_LIST_LIMIT);

  // I4.1: Today's Focus is a BUSINESS item — refusal findings surface only
  // as data-confidence notices, never as the focus of the day.
  const focus = brief.priorityQueue.find((item) =>
    item.itemType === 'action' || !isRefusal(byId.get(item.refId))) ?? null;

  return {
    overview: {
      score: brief.score,
      health: brief.health,
      generatedForRange: brief.generatedForRange,
      executiveSummary: brief.executiveSummary,
    },
    dataConfidenceNotices: brief.health.filter((h) => h.status === 'unavailable').map((h) => h.key),
    todaysFocus: focus,
    businessScore: brief.score,
    alerts: top([...brief.criticalAlerts, ...brief.warnings]),
    topOpportunities: top(brief.opportunities),
    topRisks: top(findings.filter(isRisk)),
    recentImprovements: top(findings.filter(isImprovement)),
    recentDeclines: top(findings.filter(isDecline)),
    recommendedActions: brief.recommendedActions.slice(0, DASHBOARD_LIST_LIMIT),
    quickQuestions: brief.suggestedQuestions,
  };
}
