// ============================================================
// I4.1.1 — health evidence precedence + no-data intent tests.
//
// Refusal precedence (unavailable BEFORE critical/watch/healthy), explicit
// supportive allowlist (neutral/unknown never healthy), recognized no-data
// intents terminal EN/ES/PT, determinism.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { computeHealthSections } from './healthEngine';
import { tryHandleManagerQuestion, recognizeManagerIntent } from './smartFollowups';
import type { InsightFinding } from '../insights/types';
import type { Customer, Sale } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);
const RANGE = { startYMD: '2026-07-01', endYMD: '2026-07-15' };

const finding = (over: Partial<InsightFinding> & { id: string; kind: InsightFinding['kind']; severity: InsightFinding['severity'] }): InsightFinding => ({
  confidence: 1, source: 'canonical_report_money', relatedMetrics: [], dateRange: RANGE, magnitude: 1, data: {}, ...over,
});

const empRefusal = () => finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });
const carRefusal = () => finding({ id: 'carrier_attribution_mixed:range', kind: 'carrier_attribution_mixed', severity: 'information' });

const sectionOf = (findings: InsightFinding[], key: string) =>
  computeHealthSections(findings).find((h) => h.key === key)!;

// ══ Part 1 — refusal precedence ═════════════════════════════
describe('I4.1.1 — refusal precedence (unavailable wins)', () => {
  it('1./4. refusal + warning in the same section → unavailable (not watch)', () => {
    const warn = finding({ id: 'employee_unusually_low:ana', kind: 'employee_unusually_low', severity: 'warning' });
    const employees = sectionOf([empRefusal(), warn], 'employees');
    expect(employees.status).toBe('unavailable');
    expect(employees.evaluable).toBe(false);
    expect(employees.confidence).toBe(0);
    expect(employees.reasonFindingIds).toEqual(['employee_attribution_incomplete:range']);
    // Auditability: all applicable evidence retained.
    expect(employees.evidenceFindingIds).toContain('employee_unusually_low:ana');
  });
  it('2./5. refusal + CRITICAL in the same section → unavailable (not critical)', () => {
    const crit = finding({ id: 'carrier_disappeared:att', kind: 'carrier_disappeared', severity: 'critical' });
    const carriers = sectionOf([carRefusal(), crit], 'carriers');
    expect(carriers.status).toBe('unavailable');
    expect(carriers.reasonFindingIds).toEqual(['carrier_attribution_mixed:range']);
  });
  it('3. refusal + supportive finding in the same section → unavailable (never healthy)', () => {
    const positive = finding({ id: 'carrier_highest_revenue:att', kind: 'carrier_highest_revenue', severity: 'positive' });
    const carriers = sectionOf([carRefusal(), positive], 'carriers');
    expect(carriers.status).toBe('unavailable');
  });
});

// ══ Part 2 — explicit supportive allowlist ══════════════════
describe('I4.1.1 — supportive allowlist (neutral never healthy)', () => {
  it('6. unknown/unlisted finding kind does not produce healthy', () => {
    // top_positive_contributor is a defined kind but NOT allowlisted supportive.
    const unknownish = finding({ id: 'top_positive_contributor:x', kind: 'top_positive_contributor', severity: 'positive' });
    for (const h of computeHealthSections([unknownish])) {
      expect(h.status).not.toBe('healthy');
    }
  });
  it('7. opportunity finding alone does not produce healthy (carrier_fastest_growing)', () => {
    const opp = finding({ id: 'carrier_fastest_growing:att', kind: 'carrier_fastest_growing', severity: 'opportunity' });
    expect(sectionOf([opp], 'carriers').status).toBe('unavailable');
  });
  it('8./9. informational share finding alone → unavailable, not healthy', () => {
    const share = finding({ id: 'service_share:repairs', kind: 'service_share', severity: 'information' });
    expect(sectionOf([share], 'services').status).toBe('unavailable');
  });
  it('10. explicitly positive finding still produces healthy with cited reasons', () => {
    const best = finding({ id: 'employee_best_profit:ana', kind: 'employee_best_profit', severity: 'positive' });
    const employees = sectionOf([best], 'employees');
    expect(employees.status).toBe('healthy');
    expect(employees.reasonFindingIds).toEqual([best.id]);
  });
  it('11./12. flat/up metric trend → healthy; down trend → watch (without refusal)', () => {
    const flat = finding({ id: 'metric_trend:margin', kind: 'metric_trend', severity: 'information', data: { metric: 'margin', direction: 'flat' } });
    expect(sectionOf([flat], 'margin').status).toBe('healthy');
    const down = finding({ id: 'metric_trend:profit', kind: 'metric_trend', severity: 'warning', data: { metric: 'profit', direction: 'down' } });
    expect(sectionOf([down], 'profit').status).toBe('watch');
  });
  it('13. no findings → zero healthy sections', () => {
    expect(computeHealthSections([]).filter((h) => h.status === 'healthy')).toEqual([]);
  });
});

// ══ Part 3 — recognized no-data intents ═════════════════════
describe('I4.1.1 — recognized no-data intents (terminal, honest)', () => {
  const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
  function emptyEngine(): IntelligenceEngine {
    return new IntelligenceEngine(
      [] as unknown as Sale[], [JENNY], [], [],
      { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
    );
  }
  const NO_DATA = {
    en: 'There is not enough business information to answer that yet.',
    es: 'Todavía no hay suficiente información del negocio para responder eso.',
    pt: 'Ainda não há informações suficientes do negócio para responder isso.',
  };

  it('14./17./21. focus with no findings → localized terminal no-data (never null)', () => {
    expect(tryHandleManagerQuestion(emptyEngine(), 'What should I focus on today?', 'en', REF)!.text).toBe(NO_DATA.en);
    expect(tryHandleManagerQuestion(emptyEngine(), '¿En qué me enfoco hoy?', 'es', REF)!.text).toBe(NO_DATA.es);
    expect(tryHandleManagerQuestion(emptyEngine(), 'Em que devo focar hoje?', 'pt', REF)!.text).toBe(NO_DATA.pt);
  });
  it('15. brief with no findings → terminal no-data (no normal-looking brief/score)', () => {
    const r = tryHandleManagerQuestion(emptyEngine(), 'business brief', 'en', REF)!;
    expect(r.text).toBe(NO_DATA.en);
    expect(r.text).not.toContain('/100');
    expect(r.text).not.toContain('Business brief');
  });
  it('16. health with no findings clearly states insufficient information', () => {
    const r = tryHandleManagerQuestion(emptyEngine(), 'business health', 'en', REF)!;
    expect(r.text).toContain(NO_DATA.en);
    expect(r.text).not.toMatch(/Healthy/);   // no section implies a completed evaluation
  });
  it('problem/opportunity with no findings → terminal no-data (audited truthfulness)', () => {
    expect(tryHandleManagerQuestion(emptyEngine(), 'What is my biggest problem?', 'en', REF)!.text).toBe(NO_DATA.en);
    expect(tryHandleManagerQuestion(emptyEngine(), 'What opportunity am I missing?', 'en', REF)!.text).toBe(NO_DATA.en);
  });
  it('19./20. exception terminality intact; unrecognized still null', () => {
    const broken = { getBusinessInsights: () => { throw new Error('boom'); } } as unknown as IntelligenceEngine;
    expect(tryHandleManagerQuestion(broken, 'business brief', 'en', REF)!.text).toMatch(/isn't available right now/);
    expect(recognizeManagerIntent('profit this month')).toBeNull();
    expect(tryHandleManagerQuestion(emptyEngine(), 'profit this month', 'en', REF)).toBeNull();
  });
  it('22. deterministic repeated execution', () => {
    const a = tryHandleManagerQuestion(emptyEngine(), 'business health', 'es', REF);
    const b = tryHandleManagerQuestion(emptyEngine(), 'business health', 'es', REF);
    expect(b).toEqual(a);
  });
});
