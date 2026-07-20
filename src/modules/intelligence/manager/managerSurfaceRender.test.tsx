// ============================================================
// I5 — Business Manager surface RENDER inspection (node, react-dom/server).
//
// Renders every section component to real markup from approved engine
// output — the packaged-safe runtime check available without a DOM or an
// installer: sections mount without crashing, score/confidence are visible,
// unavailable stays honest, and no action-mutation control exists in the
// rendered HTML.
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BusinessInsightsResult, InsightFinding } from '@/services/intelligence/insights/types';
import { buildManagerSurfaceModel } from './managerSurfaceModel';
import ManagerOverview from './ManagerOverview';
import TodayFocusCard from './TodayFocusCard';
import ManagerAlerts from './ManagerAlerts';
import ManagerOpportunities from './ManagerOpportunities';
import ProposedActions from './ProposedActions';
import BusinessHealthGrid from './BusinessHealthGrid';
import DataConfidenceNotice from './DataConfidenceNotice';
import ExecutiveSummary from './ExecutiveSummary';
import BusinessBriefSection from './BusinessBriefSection';

const RANGE = { startYMD: '2026-07-01', endYMD: '2026-07-15' };
const finding = (over: Partial<InsightFinding> & { id: string; kind: InsightFinding['kind']; severity: InsightFinding['severity'] }): InsightFinding => ({
  confidence: 1, source: 'canonical_report_money', relatedMetrics: [], dateRange: RANGE, magnitude: 1, data: {}, ...over,
});
const insightsOf = (findings: InsightFinding[]): BusinessInsightsResult => ({
  findings, cards: [], suggestions: [], generatedForRange: RANGE,
} as unknown as BusinessInsightsResult);

const RICH = [
  finding({ id: 'carrier_disappeared:att', kind: 'carrier_disappeared', severity: 'critical', data: { carrier: 'AT&T' } }),
  finding({ id: 'customer_lost:c1', kind: 'customer_lost', severity: 'warning', data: { name: 'PEDRO', daysSinceLastVisit: 120 } }),
  finding({ id: 'carrier_fastest_growing:tmo', kind: 'carrier_fastest_growing', severity: 'opportunity', data: { carrier: 'T-Mobile', value: 500 } }),
  finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' }),
];

function renderAll(findings: InsightFinding[], lang: 'en' | 'es' | 'pt'): string {
  const model = buildManagerSurfaceModel(insightsOf(findings), lang, 'last_30_days');
  return [
    renderToStaticMarkup(<TodayFocusCard model={model} lang={lang} />),
    renderToStaticMarkup(<ManagerAlerts model={model} lang={lang} />),
    renderToStaticMarkup(<ManagerOverview model={model} />),
    renderToStaticMarkup(<ManagerOpportunities model={model} lang={lang} />),
    renderToStaticMarkup(<ProposedActions model={model} lang={lang} />),
    renderToStaticMarkup(<BusinessHealthGrid model={model} lang={lang} />),
    renderToStaticMarkup(<DataConfidenceNotice model={model} />),
    renderToStaticMarkup(<ExecutiveSummary model={model} lang={lang} />),
    renderToStaticMarkup(<BusinessBriefSection model={model} lang={lang} />),
  ].join('\n');
}

describe('I5 — rendered markup inspection', () => {
  it('full-evidence page renders every section with visible score + confidence', () => {
    const html = renderAll(RICH, 'en');
    expect(html).toContain('Performance score');
    expect(html).toContain('Evidence confidence');
    expect(html).toContain('/100');
    expect(html).toContain('%');
    expect(html).toContain('PEDRO');
    expect(html).toContain('T-Mobile');
    expect(html).toContain('Business Health');
    expect(html).toContain('Not enough information');   // unavailable stays honest
    expect(html).not.toMatch(/refusal|attribution|_guard|canonical|undefined/i);
  });
  it('the only button in the rendered surface is the brief toggle — zero mutation controls', () => {
    const html = renderAll(RICH, 'en');
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons.length).toBe(1);                      // BusinessBriefSection expand toggle
    expect(html).not.toMatch(/Accept|Dismiss|Resolve|Assign|Start action/);
  });
  it('opportunity-only render shows no score and no confidence anywhere', () => {
    const html = renderAll([RICH[2]], 'en');
    expect(html).not.toContain('/100');
    expect(html).not.toContain('Performance score');
    expect(html).not.toContain('Evidence confidence');
    expect(html).toContain('T-Mobile');
  });
  it('ES and PT render localized and deterministic', () => {
    const es = renderAll(RICH, 'es');
    expect(es).toContain('Puntuación de desempeño');
    expect(es).toContain('Confianza de la evidencia');
    const pt = renderAll(RICH, 'pt');
    expect(pt).toContain('Pontuação de desempenho');
    expect(pt).toContain('Confiança das evidências');
    expect(renderAll(RICH, 'es')).toBe(es);              // same input → same markup
  });
});
