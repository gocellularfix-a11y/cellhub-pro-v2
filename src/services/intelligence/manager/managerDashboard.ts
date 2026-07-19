// ============================================================
// Business Manager — dashboard API (I4 Parts 7 + 12).
//
// Typed dashboard model built from one BusinessBrief — the first Business
// Manager screen is fully representable from this structure. NO UI here.
// ============================================================

import type { BusinessInsightsResult, InsightFinding } from '../insights/types';
import type { ManagerDashboard } from './types';
import { buildBusinessBrief } from './businessBriefBuilder';

export const DASHBOARD_LIST_LIMIT = 5;

function isImprovement(f: InsightFinding): boolean {
  return (f.kind === 'metric_trend' && f.data.direction === 'up')
    || f.kind === 'service_growth' || f.kind === 'carrier_fastest_growing';
}
function isDecline(f: InsightFinding): boolean {
  return (f.kind === 'metric_trend' && f.data.direction === 'down')
    || f.kind === 'service_decline' || f.kind === 'carrier_declining' || f.kind === 'carrier_disappeared';
}
function isRisk(f: InsightFinding): boolean {
  return f.severity === 'critical' || f.severity === 'warning';
}

export function buildManagerDashboard(insights: BusinessInsightsResult): ManagerDashboard {
  const brief = buildBusinessBrief(insights);
  const { findings } = insights;
  const top = (xs: InsightFinding[]) => xs.slice(0, DASHBOARD_LIST_LIMIT);

  return {
    overview: {
      score: brief.score,
      health: brief.health,
      generatedForRange: brief.generatedForRange,
      executiveSummary: brief.executiveSummary,
    },
    todaysFocus: brief.priorityQueue[0] ?? null,
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
