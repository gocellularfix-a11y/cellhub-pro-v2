// ============================================================
// I4.1 — manager production-truth hardening tests.
//
// Health truth (unavailable ≠ healthy), score/confidence separation, full
// action lifecycle, recognized-intent terminality, honest EN/ES/PT
// presentation, dashboard data-confidence notices, determinism.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { computeHealthSections } from './healthEngine';
import { computeBusinessScore, NO_FINDINGS_CONFIDENCE, CONFIDENCE_PENALTY_PER_UNAVAILABLE } from './businessScore';
import { actionsForFindings } from './actionEngine';
import { ACTION_STATUS_TRANSITIONS, canTransitionAction } from './types';
import type { BusinessActionStatus } from './types';
import { buildManagerDashboard } from './managerDashboard';
import { tryHandleManagerQuestion, recognizeManagerIntent } from './smartFollowups';
import { formatHealthSection } from './formatManager';
import type { InsightFinding } from '../insights/types';
import type { Customer, Sale, SaleItem } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);
const RANGE = { startYMD: '2026-07-01', endYMD: '2026-07-15' };

const finding = (over: Partial<InsightFinding> & { id: string; kind: InsightFinding['kind']; severity: InsightFinding['severity'] }): InsightFinding => ({
  confidence: 1, source: 'canonical_report_money', relatedMetrics: [], dateRange: RANGE, magnitude: 1, data: {}, ...over,
});

// ══ Part 1 — health truth ═══════════════════════════════════
describe('I4.1 — health truth contract', () => {
  it('1. no findings → every section unavailable, none healthy', () => {
    const health = computeHealthSections([]);
    expect(health).toHaveLength(8);
    for (const h of health) {
      expect(h.status).toBe('unavailable');
      expect(h.evaluable).toBe(false);
      expect(h.confidence).toBe(0);
    }
  });
  it('2. explicit positive revenue trend → healthy revenue WITH cited evidence', () => {
    const up = finding({ id: 'metric_trend:gross_sales', kind: 'metric_trend', severity: 'positive', data: { metric: 'gross_sales', direction: 'up' } });
    const health = computeHealthSections([up]);
    const revenue = health.find((h) => h.key === 'revenue')!;
    expect(revenue.status).toBe('healthy');
    expect(revenue.reasonFindingIds).toEqual([up.id]);
    expect(revenue.topPositiveFindingId).toBe(up.id);
  });
  it('3./4. warning → watch; critical → critical (explicit evidence only)', () => {
    const warn = finding({ id: 'margin_drop:margin', kind: 'margin_drop', severity: 'warning' });
    expect(computeHealthSections([warn]).find((h) => h.key === 'margin')!.status).toBe('watch');
    const crit = finding({ id: 'sales_below_rolling_average:gross_sales', kind: 'sales_below_rolling_average', severity: 'critical' });
    const revenue = computeHealthSections([crit]).find((h) => h.key === 'revenue')!;
    expect(revenue.status).toBe('critical');
    expect(revenue.topRiskFindingId).toBe(crit.id);
  });
  it('5./6. refusal findings → unavailable, NEVER healthy', () => {
    const empRefusal = finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });
    const carRefusal = finding({ id: 'carrier_attribution_mixed:range', kind: 'carrier_attribution_mixed', severity: 'information' });
    const health = computeHealthSections([empRefusal, carRefusal]);
    const employees = health.find((h) => h.key === 'employees')!;
    const carriers = health.find((h) => h.key === 'carriers')!;
    expect(employees.status).toBe('unavailable');
    expect(employees.reasonFindingIds).toEqual([empRefusal.id]);
    expect(carriers.status).toBe('unavailable');
  });
  it('information-severity NEGATIVES (inactive customer, stopped product) → watch, not healthy', () => {
    const inactive = finding({ id: 'customer_inactive:c1', kind: 'customer_inactive', severity: 'information' });
    const stopped = finding({ id: 'product_stopped_selling:x', kind: 'product_stopped_selling', severity: 'information' });
    const health = computeHealthSections([inactive, stopped]);
    expect(health.find((h) => h.key === 'customers')!.status).toBe('watch');
    expect(health.find((h) => h.key === 'inventory')!.status).toBe('watch');
  });
});

// ══ Part 2 — score vs confidence ════════════════════════════
describe('I4.1 — score/confidence separation', () => {
  it('7./9. unavailable sections never move the performance score; no findings → floor confidence', () => {
    const empty = computeBusinessScore([], 8);
    expect(empty.score).toBe(100);                       // performance untouched by absence
    expect(empty.confidence).toBe(NO_FINDINGS_CONFIDENCE); // but confidence is floored — no false certainty
    const same = computeBusinessScore([], 0);
    expect(same.score).toBe(empty.score);                // unavailable count never a score input
  });
  it('8. each unavailable section lowers confidence deterministically', () => {
    const f = finding({ id: 'metric_trend:gross_sales', kind: 'metric_trend', severity: 'positive', data: { metric: 'gross_sales', direction: 'up' } });
    const none = computeBusinessScore([f], 0);
    const three = computeBusinessScore([f], 3);
    expect(none.confidence).toBe(1);
    expect(three.confidence).toBe(Math.round((1 - 3 * CONFIDENCE_PENALTY_PER_UNAVAILABLE) * 100) / 100);
    expect(three.score).toBe(none.score);
  });
  it('refusal findings do not penalize performance; opportunities are not failures', () => {
    const refusal = finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });
    const opportunity = finding({ id: 'carrier_fastest_growing:att', kind: 'carrier_fastest_growing', severity: 'opportunity' });
    const score = computeBusinessScore([refusal, opportunity], 0);
    expect(score.score).toBeGreaterThanOrEqual(100);   // no negative offsets
  });
});

// ══ Part 3 — action lifecycle ═══════════════════════════════
describe('I4.1 — action lifecycle', () => {
  it('10./11. new actions default to proposed; all five statuses exist', () => {
    const lost = finding({ id: 'customer_lost:c1', kind: 'customer_lost', severity: 'warning' });
    const [action] = actionsForFindings([lost]);
    expect(action.status).toBe('proposed');
    const statuses: BusinessActionStatus[] = ['proposed', 'accepted', 'in_progress', 'resolved', 'dismissed'];
    for (const s of statuses) expect(ACTION_STATUS_TRANSITIONS[s]).toBeDefined();
  });
  it('12./13. transition contract: valid paths allowed, invalid rejected', () => {
    expect(canTransitionAction('proposed', 'accepted')).toBe(true);
    expect(canTransitionAction('proposed', 'dismissed')).toBe(true);
    expect(canTransitionAction('accepted', 'in_progress')).toBe(true);
    expect(canTransitionAction('in_progress', 'resolved')).toBe(true);
    expect(canTransitionAction('proposed', 'resolved')).toBe(false);
    expect(canTransitionAction('resolved', 'proposed')).toBe(false);
    expect(canTransitionAction('dismissed', 'accepted')).toBe(false);
    expect(canTransitionAction('proposed', 'in_progress')).toBe(false);
  });
});

// ══ Part 4 — recognized-intent terminality ══════════════════
describe('I4.1 — manager intent terminality', () => {
  const broken = { getBusinessInsights: () => { throw new Error('boom'); } } as unknown as IntelligenceEngine;

  it('14./15./16. recognized intent + engine exception → localized terminal, never null', () => {
    const en = tryHandleManagerQuestion(broken, 'What should I focus on today?', 'en', REF);
    expect(en).not.toBeNull();
    expect(en!.text).toMatch(/isn't available right now/);
    expect(tryHandleManagerQuestion(broken, '¿Cuál es mi mayor problema?', 'es', REF)!.text).toMatch(/no está disponible/);
    expect(tryHandleManagerQuestion(broken, 'Qual oportunidade estou perdendo?', 'pt', REF)!.text).toMatch(/não está disponível/);
  });
  it('17. unrecognized phrase → null (normal routing continues)', () => {
    expect(recognizeManagerIntent('profit this month')).toBeNull();
    expect(tryHandleManagerQuestion(broken, 'profit this month', 'en', REF)).toBeNull();
  });
  it('brief + health intents are recognized and terminal too', () => {
    expect(recognizeManagerIntent('business brief')).toBe('brief');
    expect(recognizeManagerIntent('business health')).toBe('health');
    expect(recognizeManagerIntent('¿Cómo va el negocio?')).toBe('health');
    expect(tryHandleManagerQuestion(broken, 'business health', 'en', REF)).not.toBeNull();
  });
});

// ══ Parts 5-6 — presentation truth + dashboard ══════════════
describe('I4.1 — presentation + dashboard truth', () => {
  const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
  function emptyEngine(): IntelligenceEngine {
    return new IntelligenceEngine(
      [] as unknown as Sale[], [JENNY], [], [],
      { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
    );
  }

  it('18. unavailable renders honestly EN/ES/PT — never healthy/all-clear', () => {
    const section = computeHealthSections([]).find((h) => h.key === 'employees')!;
    expect(formatHealthSection(section, 'en')).toContain('Not enough information to evaluate this area');
    expect(formatHealthSection(section, 'es')).toContain('No hay suficiente información para evaluar esta área');
    expect(formatHealthSection(section, 'pt')).toContain('Não há informações suficientes para avaliar esta área');
    for (const lang of ['en', 'es', 'pt'] as const) {
      const text = formatHealthSection(section, lang).toLowerCase();
      expect(text).not.toMatch(/healthy|saludable|saudável|all clear|no problems/);
      expect(text).not.toMatch(/refusal|attribution|canonical|undefined/);
    }
  });
  it('19. dashboard surfaces data-confidence notices; no-data stays honest + useful', () => {
    const dash = buildManagerDashboard(emptyEngine().getBusinessInsights(REF, 'this_month'));
    expect(dash.dataConfidenceNotices.length).toBe(8);          // nothing evaluable
    expect(dash.overview.health.every((h) => h.status === 'unavailable')).toBe(true);
    expect(dash.overview.score.confidence).toBeLessThanOrEqual(0.2);
    expect(dash.topRisks).toEqual([]);                          // absence of evidence ≠ risk
  });
  it("today's focus never selects a refusal finding as the business problem", () => {
    const refusal = finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });
    const insights = {
      findings: [refusal], cards: [], suggestions: [],
      generatedForRange: RANGE,
    };
    const dash = buildManagerDashboard(insights as never);
    // The only finding is a refusal → no business focus is fabricated.
    expect(dash.todaysFocus).toBeNull();
    expect(dash.dataConfidenceNotices).toContain('employees');
    expect(dash.topRisks).toEqual([]);
  });
  it('20. deterministic repeated execution (dashboard equality)', () => {
    const a = buildManagerDashboard(emptyEngine().getBusinessInsights(REF, 'this_month'));
    const b = buildManagerDashboard(emptyEngine().getBusinessInsights(REF, 'this_month'));
    expect(b).toEqual(a);
  });
});
