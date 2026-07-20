// ============================================================
// Business Manager surface (I5) — pure view-model.
//
// The ONLY behavior layer of the visible manager page. Consumes the approved
// I4 contracts (BusinessInsightsResult → buildBusinessBrief /
// buildManagerDashboard) and the approved presenters — the UI never
// recalculates score, confidence, health, priority, severity or evidence.
// Evidence gating reuses the exported I4.1.3 helpers so the page can never
// present an opportunity-only period as a completed performance brief.
//
// Pure function of its inputs → deterministic, node-testable (no DOM).
// ============================================================

import type { BusinessInsightsResult, InsightFinding } from '@/services/intelligence/insights/types';
import { formatFinding } from '@/services/intelligence/insights/formatFindings';
import {
  buildBusinessBrief,
  buildManagerDashboard,
  formatBusinessBrief,
  formatAction,
  formatHealthSection,
  formatSummaryItem,
  hasBriefPerformanceEvidence,
  hasProblemEvidence,
  hasFocusEvidence,
} from '@/services/intelligence/manager';
import type { BusinessAction, BusinessActionPriority, HealthStatus } from '@/services/intelligence/manager';
import { ms, type ManagerLang } from './strings';

/** Range kinds validated by the approved engine API — nothing else. */
export const SUPPORTED_MANAGER_RANGES = ['today', 'yesterday', 'this_week', 'this_month', 'last_30_days'] as const;
export type SupportedManagerRange = typeof SUPPORTED_MANAGER_RANGES[number];
export const DEFAULT_MANAGER_RANGE: SupportedManagerRange = 'last_30_days';

export function rangeLabel(kind: SupportedManagerRange, lang: ManagerLang): string {
  switch (kind) {
    case 'today': return ms('rangeToday', lang);
    case 'yesterday': return ms('rangeYesterday', lang);
    case 'this_week': return ms('rangeThisWeek', lang);
    case 'this_month': return ms('rangeThisMonth', lang);
    default: return ms('rangeLast30', lang);
  }
}

export type ManagerSurfaceState = 'ready' | 'opportunity_only' | 'no_data';

export interface FindingView {
  text: string;
  severity: 'critical' | 'warning' | 'opportunity';
  actionText: string | null;
}

export interface ActionView {
  text: string;
  priorityLabel: string;
  priority: BusinessActionPriority;
  statusLabel: string;      // always the localized "Proposed" — read-only surface
  createdYMD: string;
}

export interface HealthTileView {
  label: string;            // localized section name (from the approved presenter)
  statusLabel: string;      // localized status text (from the approved presenter)
  status: HealthStatus;     // styling input only — never rendered as text
}

export interface ManagerSurfaceModel {
  state: ManagerSurfaceState;
  rangeLabel: string;
  periodLabel: string;                       // "YYYY-MM-DD → YYYY-MM-DD"
  /** Full-page honest message when nothing is evaluable. */
  noDataText: string | null;
  /** Score block — null unless supported performance evidence exists. */
  score: { value: number; label: string } | null;
  /** Confidence block — rendered whole percentage, never a raw decimal. */
  confidence: { pct: number; label: string; hint: string } | null;
  /** Honest replacement for the score block in opportunity-only periods. */
  performanceUnavailableText: string | null;
  focus: { text: string; why: string; actionText: string | null } | null;
  focusEmptyText: string | null;
  criticalAlerts: FindingView[];
  warnings: FindingView[];
  alertsEmptyText: string | null;
  opportunities: FindingView[];
  opportunitiesEmptyText: string | null;
  actions: ActionView[];
  actionsEmptyText: string | null;
  health: HealthTileView[];
  notices: { title: string; explain: string; areas: string[] } | null;
  executiveSummary: string[];
  /** Approved full-brief presenter output — null unless a real brief exists. */
  briefText: string | null;
  briefUnavailableText: string | null;
  questions: string[];
}

/** Neutral-vs-status visual tone. Pure — unavailable is NEVER positive. */
export function healthTone(status: HealthStatus): 'positive' | 'warning' | 'critical' | 'neutral' {
  if (status === 'healthy') return 'positive';
  if (status === 'watch') return 'warning';
  if (status === 'critical') return 'critical';
  return 'neutral';
}

function priorityLabel(p: BusinessActionPriority, lang: ManagerLang): string {
  if (p === 'critical') return ms('priorityCritical', lang);
  if (p === 'high') return ms('priorityHigh', lang);
  if (p === 'medium') return ms('priorityMedium', lang);
  return ms('priorityLow', lang);
}

/** Splits the approved "Section: Status" presenter line at the FIRST colon —
 *  keeps the surface at zero duplicated health vocabulary. */
function splitHealthLine(line: string): { label: string; statusLabel: string } {
  const idx = line.indexOf(':');
  if (idx < 0) return { label: line, statusLabel: '' };
  return { label: line.slice(0, idx).trim(), statusLabel: line.slice(idx + 1).trim() };
}

export function buildManagerSurfaceModel(
  insights: BusinessInsightsResult,
  lang: ManagerLang,
  range: SupportedManagerRange,
): ManagerSurfaceModel {
  const brief = buildBusinessBrief(insights);
  const dashboard = buildManagerDashboard(insights);
  const byId = new Map(insights.findings.map((f) => [f.id, f] as const));

  // Approved intent-specific evidence contracts (I4.1.3) — never re-derived.
  const briefEvidence = hasBriefPerformanceEvidence(insights.findings);
  const problemEvidence = hasProblemEvidence(insights.findings);
  const focusEvidence = hasFocusEvidence(insights.findings);

  const state: ManagerSurfaceState = briefEvidence ? 'ready' : focusEvidence ? 'opportunity_only' : 'no_data';
  const period = `${brief.generatedForRange.startYMD} → ${brief.generatedForRange.endYMD}`;

  const base: ManagerSurfaceModel = {
    state,
    rangeLabel: rangeLabel(range, lang),
    periodLabel: period,
    noDataText: null,
    score: null,
    confidence: null,
    performanceUnavailableText: null,
    focus: null,
    focusEmptyText: null,
    criticalAlerts: [],
    warnings: [],
    alertsEmptyText: null,
    opportunities: [],
    opportunitiesEmptyText: null,
    actions: [],
    actionsEmptyText: null,
    health: [],
    notices: null,
    executiveSummary: [],
    briefText: null,
    briefUnavailableText: null,
    questions: [],
  };

  if (state === 'no_data') {
    // Honest full-page state — no fake score, no fabricated sections.
    return { ...base, noDataText: ms('noData', lang) };
  }

  const relatedActionText = (f: InsightFinding): string | null => {
    const action = brief.recommendedActions.find((a) => a.relatedFindingId === f.id);
    return action ? formatAction(action, lang) : null;
  };
  const findingView = (f: InsightFinding, severity: FindingView['severity']): FindingView => ({
    text: formatFinding(f, lang),
    severity,
    actionText: relatedActionText(f),
  });

  // ── Today's Focus — resolved from the APPROVED dashboard selection ──
  let focus: ManagerSurfaceModel['focus'] = null;
  const focusItem = dashboard.todaysFocus;
  if (focusItem) {
    if (focusItem.itemType === 'action') {
      const action = brief.recommendedActions.find((a) => a.id === focusItem.refId);
      if (action) focus = { text: formatAction(action, lang), why: ms('focusWhyAction', lang), actionText: null };
    } else {
      const finding = byId.get(focusItem.refId);
      if (finding) {
        const why = finding.severity === 'critical' ? ms('focusWhyCritical', lang)
          : finding.severity === 'warning' ? ms('focusWhyWarning', lang)
          : ms('focusWhyOpportunity', lang);
        focus = { text: formatFinding(finding, lang), why, actionText: relatedActionText(finding) };
      }
    }
  }

  // ── Alerts / risks — approved brief lists, critical vs warning distinct ──
  const criticalAlerts = brief.criticalAlerts.map((f) => findingView(f, 'critical'));
  const warnings = brief.warnings.map((f) => findingView(f, 'warning'));

  // ── Opportunities — honest insufficiency, never confirmed absence ──
  const opportunities = brief.opportunities.map((f) => findingView(f, 'opportunity'));
  const opportunitiesEmptyText = opportunities.length > 0 ? null
    : (briefEvidence || problemEvidence) ? ms('opportunitiesInsufficient', lang)
    : ms('noData', lang);

  // ── Read-only proposed actions — display models only, no lifecycle ──
  const actions: ActionView[] = brief.recommendedActions.map((a: BusinessAction) => ({
    text: formatAction(a, lang),
    priorityLabel: priorityLabel(a.priority, lang),
    priority: a.priority,
    statusLabel: ms('statusProposed', lang),
    createdYMD: a.createdYMD,
  }));

  // ── Health — every approved section, presenter-localized ──
  const health: HealthTileView[] = brief.health.map((h) => {
    const { label, statusLabel } = splitHealthLine(formatHealthSection(h, lang));
    return { label, statusLabel, status: h.status };
  });
  const unavailableAreas = brief.health
    .filter((h) => h.status === 'unavailable')
    .map((h) => splitHealthLine(formatHealthSection(h, lang)).label);
  const notices = unavailableAreas.length > 0
    ? { title: ms('dataNotices', lang), explain: ms('dataNoticesExplain', lang), areas: unavailableAreas }
    : null;

  const isReady = state === 'ready';
  return {
    ...base,
    // Score + confidence ONLY with supported performance evidence — an
    // opportunity-only period keeps the honest replacement text instead.
    score: isReady ? { value: brief.score.score, label: ms('performanceScore', lang) } : null,
    confidence: isReady
      ? { pct: Math.round(brief.score.confidence * 100), label: ms('evidenceConfidence', lang), hint: ms('confidenceHint', lang) }
      : null,
    performanceUnavailableText: isReady ? null : ms('performanceUnavailable', lang),
    focus,
    focusEmptyText: focus ? null : ms('focusEmpty', lang),
    criticalAlerts,
    warnings,
    alertsEmptyText: criticalAlerts.length + warnings.length > 0 ? null : ms('alertsEmpty', lang),
    opportunities,
    opportunitiesEmptyText,
    actions,
    actionsEmptyText: actions.length > 0 ? null : ms('actionsEmpty', lang),
    health,
    notices,
    executiveSummary: isReady ? brief.executiveSummary.map((i) => formatSummaryItem(i, lang)).filter(Boolean) : [],
    briefText: isReady ? formatBusinessBrief(brief, lang, byId) : null,
    briefUnavailableText: isReady ? null : ms('noData', lang),
    questions: brief.suggestedQuestions.map((q) => q.text),
  };
}
