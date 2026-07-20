// ============================================================
// I5 — Business Manager visible surface tests.
//
// Behavior tests over the pure view-model (vitest runs in node env — the
// repo convention is pure-helper tests, not DOM renders) plus source-level
// guards proving the UI neither mutates actions nor recalculates
// intelligence, and navigation/i18n wiring checks.
// ============================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_TABS, canAccessTab } from '@/config/constants';
import { translations } from '@/i18n/translations';
import { IntelligenceEngine } from '@/services/intelligence';
import { buildBusinessBrief, buildManagerDashboard, tryHandleManagerQuestion } from '@/services/intelligence/manager';
import { formatFinding } from '@/services/intelligence/insights/formatFindings';
import type { BusinessInsightsResult, InsightFinding } from '@/services/intelligence/insights/types';
import type { Customer, Sale } from '@/store/types';
import {
  buildManagerSurfaceModel,
  healthTone,
  rangeLabel,
  SUPPORTED_MANAGER_RANGES,
  DEFAULT_MANAGER_RANGE,
} from './managerSurfaceModel';
import { ms, MANAGER_STRINGS } from './strings';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RANGE = { startYMD: '2026-07-01', endYMD: '2026-07-15' };
const REF = new Date(2026, 6, 15, 12, 0, 0);

const finding = (over: Partial<InsightFinding> & { id: string; kind: InsightFinding['kind']; severity: InsightFinding['severity'] }): InsightFinding => ({
  confidence: 1, source: 'canonical_report_money', relatedMetrics: [], dateRange: RANGE, magnitude: 1, data: {}, ...over,
});
const risk = () => finding({ id: 'customer_lost:c1', kind: 'customer_lost', severity: 'warning', data: { name: 'PEDRO', daysSinceLastVisit: 120 } });
const critical = () => finding({ id: 'carrier_disappeared:att', kind: 'carrier_disappeared', severity: 'critical', data: { carrier: 'AT&T' } });
const opp = () => finding({ id: 'carrier_fastest_growing:tmo', kind: 'carrier_fastest_growing', severity: 'opportunity', data: { carrier: 'T-Mobile', value: 500 } });
const refusal = () => finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });

const insightsOf = (findings: InsightFinding[]): BusinessInsightsResult => ({
  findings, cards: [], suggestions: [], generatedForRange: RANGE,
} as unknown as BusinessInsightsResult);

const model = (findings: InsightFinding[], lang: 'en' | 'es' | 'pt' = 'en') =>
  buildManagerSurfaceModel(insightsOf(findings), lang, DEFAULT_MANAGER_RANGE);

// ══ 1. Navigation entry ═════════════════════════════════════
describe('I5 — navigation wiring', () => {
  it('1. Business Manager tab exists, admin-only, localized EN/ES/PT', () => {
    const tab = NAV_TABS.find((t) => t.id === 'manager');
    expect(tab).toBeTruthy();
    expect(tab!.adminOnly).toBe(true);
    expect(tab!.labelKey).toBe('businessManager');
    const label = translations['nav.businessManager'];
    expect(label.en).toBe('Business Manager');
    expect(label.es).toBe('Gerente del Negocio');
    expect(label.pt).toBe('Gerente do Negócio');
    // Non-admin roles cannot reach it via role defaults.
    expect(canAccessTab('manager', 'cashier')).toBe(false);
    expect(canAccessTab('manager', 'owner')).toBe(true);
  });
});

// ══ 2./3./12./18./24. Source-level guards ═══════════════════
describe('I5 — UI never mutates or recalculates intelligence', () => {
  const sources = fs.readdirSync(DIR)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(DIR, f), 'utf8') }));

  it('2./3. no duplicated intelligence calculation in the surface', () => {
    // The UI may import ONLY the approved public manager surface + insights
    // presenter — never score/health/priority/action internals or canonical money.
    const forbiddenImports = [
      '/businessScore', '/healthEngine', '/priorityEngine', '/actionEngine',
      'computeReportMoneyStats', 'customerMoneyProfile', 'canonicalMoney',
      'computeBusinessScore(', 'computeHealthSections(', 'buildPriorityQueue(', 'actionsForFindings(',
    ];
    for (const { file, text } of sources) {
      for (const bad of forbiddenImports) {
        expect(text.includes(bad), `${file} must not reference ${bad}`).toBe(false);
      }
    }
  });
  it('12. no action-mutation controls or persistence exist', () => {
    const forbidden = [
      'approveQueueItem', 'dismissQueueItem', 'resolveQueueItem', 'snoozeQueueItem',
      'localStorage', 'sessionStorage', 'canTransitionAction', 'setInterval', 'setTimeout',
    ];
    for (const { file, text } of sources) {
      for (const bad of forbidden) {
        expect(text.includes(bad), `${file} must not reference ${bad}`).toBe(false);
      }
    }
  });
  it('18. error state has no legacy-calculation fallback', () => {
    const page = sources.find((s) => s.file === 'BusinessManagerPage.tsx')!.text;
    for (const legacy of ['getTodayMoney', 'analyze()', 'getMetrics', 'computeCustomerProfit']) {
      expect(page.includes(legacy)).toBe(false);
    }
    expect(page.includes("ms('managerError'")).toBe(true);
  });
  it('24. UI strings contain no internal terminology', () => {
    for (const key of Object.keys(MANAGER_STRINGS) as Array<keyof typeof MANAGER_STRINGS>) {
      for (const lang of ['en', 'es', 'pt'] as const) {
        expect(MANAGER_STRINGS[key][lang]).not.toMatch(/refusal|attribution|canonical|cents|undefined|_guard/i);
        expect(MANAGER_STRINGS[key][lang]).not.toMatch(/\bNaN\b/);   // case-sensitive: 'Ganancia' etc. are legit ES words
      }
    }
  });
});

// ══ 4.-11./13.-16. Ready-state model behavior ═══════════════
describe('I5 — model consumes the approved manager contracts', () => {
  it('4./5./6. supported risk → score AND separate whole-percentage confidence', () => {
    const m = model([risk()]);
    expect(m.state).toBe('ready');
    const brief = buildBusinessBrief(insightsOf([risk()]));
    expect(m.score).toEqual({ value: brief.score.score, label: 'Performance score' });
    expect(m.confidence!.label).toBe('Evidence confidence');
    expect(m.confidence!.pct).toBe(Math.round(brief.score.confidence * 100));
    expect(Number.isInteger(m.confidence!.pct)).toBe(true);
    expect(m.confidence!.hint).toBe('How complete the available business evidence is.');
  });
  it("7. Today's Focus resolves the approved dashboard focus", () => {
    const m = model([risk()]);
    const dashboard = buildManagerDashboard(insightsOf([risk()]));
    expect(dashboard.todaysFocus).not.toBeNull();
    expect(m.focus).not.toBeNull();
    expect(m.focus!.text).toContain('PEDRO');
    expect(m.focus!.why.length).toBeGreaterThan(0);
  });
  it('8./9. critical and warning findings render distinctly', () => {
    const m = model([critical(), risk()]);
    expect(m.criticalAlerts.length).toBe(1);
    expect(m.criticalAlerts[0].severity).toBe('critical');
    expect(m.criticalAlerts[0].text).toBe(formatFinding(critical(), 'en'));
    expect(m.warnings.length).toBe(1);
    expect(m.warnings[0].severity).toBe('warning');
    expect(m.warnings[0].text).toContain('PEDRO');
  });
  it('10./11. opportunity + related proposed action render read-only', () => {
    const m = model([risk(), opp()]);
    expect(m.opportunities.length).toBe(1);
    expect(m.opportunities[0].text).toContain('T-Mobile');
    expect(m.opportunities[0].actionText).toBeTruthy();       // lean_into_carrier_growth
    expect(m.actions.length).toBeGreaterThan(0);
    for (const a of m.actions) {
      expect(a.statusLabel).toBe('Proposed');                 // read-only status only
      expect(a.createdYMD).toBe(RANGE.endYMD);
      expect(Object.keys(a)).toEqual(['text', 'priorityLabel', 'priority', 'statusLabel', 'createdYMD']);  // no callbacks/lifecycle controls
    }
  });
  it('13./14. all eight health sections; unavailable is neutral, never healthy-looking', () => {
    const m = model([risk()]);
    expect(m.health.length).toBe(8);
    const unavailable = m.health.filter((h) => h.status === 'unavailable');
    expect(unavailable.length).toBeGreaterThan(0);
    for (const h of unavailable) {
      expect(healthTone(h.status)).toBe('neutral');
      expect(h.statusLabel).toContain('Not enough information');
      expect(h.statusLabel).not.toMatch(/Healthy/);
    }
    expect(healthTone('healthy')).toBe('positive');
    expect(healthTone('watch')).toBe('warning');
    expect(healthTone('critical')).toBe('critical');
    expect(healthTone('unavailable')).not.toBe('positive');
  });
  it('15./16. unavailable notices render and partial evidence keeps the page usable', () => {
    const m = model([risk(), refusal()]);
    expect(m.state).toBe('ready');                            // partial evidence still renders
    expect(m.notices).not.toBeNull();
    expect(m.notices!.areas.length).toBeGreaterThan(0);
    expect(m.notices!.explain).toBe('These areas could not be evaluated with enough evidence.');
    expect(m.score).not.toBeNull();                           // confidence always visible with a score
    expect(m.confidence).not.toBeNull();
    expect(m.briefText).toContain('Evidence confidence');     // approved presenter keeps notices+confidence
    expect(m.briefText).toContain('Not enough information for:');
  });
});

// ══ 17./19./20. Honest no-data / insufficiency states ═══════
describe('I5 — honest states', () => {
  it('17. no findings → honest no-data page (EN/ES/PT), no score', () => {
    for (const [lang, text] of [
      ['en', 'There is not enough business information to evaluate this yet.'],
      ['es', 'Todavía no hay suficiente información del negocio para evaluar esto.'],
      ['pt', 'Ainda não há informações suficientes do negócio para avaliar isto.'],
    ] as const) {
      const m = model([], lang);
      expect(m.state).toBe('no_data');
      expect(m.noDataText).toBe(text);
      expect(m.score).toBeNull();
      expect(m.confidence).toBeNull();
      expect(m.briefText).toBeNull();
    }
    // Refusal-only input is equally non-evaluable.
    expect(model([refusal()]).state).toBe('no_data');
  });
  it('19. opportunity absence uses the approved insufficient wording — parity with chat', () => {
    const m = model([risk()]);
    const chatEngine = { getBusinessInsights: () => insightsOf([risk()]) } as unknown as IntelligenceEngine;
    const chat = tryHandleManagerQuestion(chatEngine, 'What opportunity am I missing?', 'en', REF)!;
    expect(m.opportunitiesEmptyText).toBe(chat.text);         // exact parity with I4.1.4
    expect(m.opportunitiesEmptyText).not.toContain('No standout opportunities');
    expect(model([risk()], 'es').opportunitiesEmptyText).not.toContain('No hay oportunidades');
    expect(model([risk()], 'pt').opportunitiesEmptyText).not.toContain('Nenhuma oportunidade');
  });
  it('20. opportunity-only period never presents a completed performance brief', () => {
    const m = model([opp()]);
    expect(m.state).toBe('opportunity_only');
    expect(m.score).toBeNull();
    expect(m.confidence).toBeNull();
    expect(m.briefText).toBeNull();
    expect(m.briefUnavailableText).toBe('There is not enough business information to evaluate this yet.');
    expect(m.performanceUnavailableText).toBe('Not enough supported evidence to evaluate performance for this period.');
    expect(m.executiveSummary).toEqual([]);
    expect(m.opportunities.length).toBe(1);                   // the opportunity itself still shows
    expect(m.focus).not.toBeNull();                           // focused on the opportunity
    expect(JSON.stringify(m)).not.toContain('/100');
  });
});

// ══ 21.-23./25. EN/ES/PT + presentation safety ══════════════
describe('I5 — localization and presentation safety', () => {
  it('21./22./23. key labels are localized and distinct per language', () => {
    expect(ms('title', 'en')).toBe('Business Manager');
    expect(ms('title', 'es')).toBe('Gerente del Negocio');
    expect(ms('title', 'pt')).toBe('Gerente do Negócio');
    expect(ms('performanceScore', 'es')).toBe('Puntuación de desempeño');
    expect(ms('performanceScore', 'pt')).toBe('Pontuação de desempenho');
    expect(ms('evidenceConfidence', 'es')).toBe('Confianza de la evidencia');
    expect(ms('evidenceConfidence', 'pt')).toBe('Confiança das evidências');
    for (const key of ['todaysFocus', 'criticalAlerts', 'risksAndWarnings', 'opportunities', 'proposedActions', 'businessHealth', 'readOnly', 'refresh', 'dataNotices'] as const) {
      expect(ms(key, 'en')).toBeTruthy();
      expect(ms(key, 'es')).toBeTruthy();
      expect(ms(key, 'pt')).toBeTruthy();
    }
    // Localized model spot-checks.
    expect(model([risk()], 'es').score!.label).toBe('Puntuación de desempeño');
    expect(model([risk()], 'pt').confidence!.label).toBe('Confiança das evidências');
  });
  it('25. rendered model never exposes internal terminology, undefined, NaN or raw decimals', () => {
    for (const lang of ['en', 'es', 'pt'] as const) {
      const m = model([critical(), risk(), opp(), refusal()], lang);
      const json = JSON.stringify(m);
      expect(json).not.toMatch(/refusal|attribution|_guard|canonical|cents|undefined/i);
      expect(json).not.toMatch(/\bNaN\b/);   // case-sensitive: ES 'Ganancia' contains 'nan'
      expect(Number.isInteger(m.confidence!.pct)).toBe(true);
      expect(json).not.toMatch(/"pct":\d+\.\d/);
    }
  });
});

// ══ 26.-28. Ranges, refresh, determinism ════════════════════
describe('I5 — ranges and determinism', () => {
  it('26. only engine-validated range kinds are exposed; default last_30_days', () => {
    expect([...SUPPORTED_MANAGER_RANGES]).toEqual(['today', 'yesterday', 'this_week', 'this_month', 'last_30_days']);
    expect(DEFAULT_MANAGER_RANGE).toBe('last_30_days');
    for (const k of SUPPORTED_MANAGER_RANGES) {
      expect(rangeLabel(k, 'en')).toBeTruthy();
      expect(rangeLabel(k, 'es')).toBeTruthy();
      expect(rangeLabel(k, 'pt')).toBeTruthy();
    }
  });
  it('27./28. same engine input + reference date → equivalent model (refresh determinism)', () => {
    const engine = new IntelligenceEngine(
      [] as unknown as Sale[],
      [{ id: 'c1', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer],
      [], [],
      { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
    );
    const a = buildManagerSurfaceModel(engine.getBusinessInsights(REF, 'last_30_days'), 'en', 'last_30_days');
    engine.invalidateCache();                                  // what the refresh button does
    const b = buildManagerSurfaceModel(engine.getBusinessInsights(REF, 'last_30_days'), 'en', 'last_30_days');
    expect(b).toEqual(a);
    // Synthetic determinism too.
    expect(model([critical(), risk(), opp()])).toEqual(model([critical(), risk(), opp()]));
  });
  it('29. recognized chat manager intents remain intact next to the surface', () => {
    const chatEngine = { getBusinessInsights: () => insightsOf([risk()]) } as unknown as IntelligenceEngine;
    expect(tryHandleManagerQuestion(chatEngine, 'business brief', 'en', REF)!.text).toContain('Performance score');
    expect(tryHandleManagerQuestion(chatEngine, 'profit this month', 'en', REF)).toBeNull();
  });
});
