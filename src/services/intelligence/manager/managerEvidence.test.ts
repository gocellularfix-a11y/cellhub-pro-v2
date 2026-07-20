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
import { tryHandleManagerQuestion, recognizeManagerIntent, hasApplicableManagerEvidence, hasBriefPerformanceEvidence, hasFocusEvidence, hasProblemEvidence, hasOpportunityEvidence } from './smartFollowups';
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
  it('10./28./29. service_growth is PER-POPULATION (typed I3-3 scope) → never proves complete services health', () => {
    // I4.1.3 audit: the finding contract keys per population
    // (`service_growth:${population}`, data.population) — growth of ONE
    // service type, not the whole services area → neutral → unavailable.
    const growth = finding({ id: 'service_growth:repairs', kind: 'service_growth', severity: 'positive', data: { population: 'repairs', changePct: 40 } });
    expect(growth.id).toContain(':repairs');           // per-population scope evidence
    expect(growth.data.population).toBe('repairs');
    const services = sectionOf([growth], 'services');
    expect(services.status).toBe('unavailable');
  });
  it('11./12. UP metric trend → healthy; FLAT → unavailable (no level proof); down → watch', () => {
    const up = finding({ id: 'metric_trend:gross_sales', kind: 'metric_trend', severity: 'positive', data: { metric: 'gross_sales', direction: 'up' } });
    expect(sectionOf([up], 'revenue').status).toBe('healthy');
    const flat = finding({ id: 'metric_trend:margin', kind: 'metric_trend', severity: 'information', data: { metric: 'margin', direction: 'flat' } });
    expect(sectionOf([flat], 'margin').status).toBe('unavailable');   // I4.1.2: flat ≠ good level
    const down = finding({ id: 'metric_trend:profit', kind: 'metric_trend', severity: 'warning', data: { metric: 'profit', direction: 'down' } });
    expect(sectionOf([down], 'profit').status).toBe('watch');
  });
  it('13. no findings → zero healthy sections', () => {
    expect(computeHealthSections([]).filter((h) => h.status === 'healthy')).toEqual([]);
  });
});

// ══ I4.1.2 — ranking/pattern evidence + applicable manager evidence ══
describe('I4.1.2 — rankings and isolated patterns never prove health', () => {
  it('1-6. every relative ranking alone → its section unavailable', () => {
    const cases: Array<[InsightFinding['kind'], string]> = [
      ['employee_best_revenue', 'employees'], ['employee_best_profit', 'employees'], ['employee_best_margin', 'employees'],
      ['employee_most_repairs', 'employees'], ['employee_most_unlocks', 'employees'], ['employee_highest_avg_ticket', 'employees'],
      ['carrier_highest_revenue', 'carriers'], ['carrier_highest_profit', 'carriers'], ['carrier_highest_transactions', 'carriers'],
    ];
    for (const [kind, section] of cases) {
      const f = finding({ id: `${kind}:x`, kind, severity: 'positive' });
      expect(sectionOf([f], section).status, kind).toBe('unavailable');
    }
  });
  it('7./8. isolated customer patterns alone → customers unavailable', () => {
    const hv = finding({ id: 'customer_high_value:c1', kind: 'customer_high_value', severity: 'positive' });
    expect(sectionOf([hv], 'customers').status).toBe('unavailable');
    const freq = finding({ id: 'customer_frequent:c1', kind: 'customer_frequent', severity: 'positive' });
    expect(sectionOf([freq], 'customers').status).toBe('unavailable');
  });
  it('13. refusal still overrides upward evidence', () => {
    const up = finding({ id: 'metric_trend:gross_sales', kind: 'metric_trend', severity: 'positive', data: { metric: 'gross_sales', direction: 'up' } });
    const refusal = finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });
    const warn = finding({ id: 'employee_unusually_low:a', kind: 'employee_unusually_low', severity: 'warning' });
    const employees = computeHealthSections([up, refusal, warn]).find((h) => h.key === 'employees')!;
    expect(employees.status).toBe('unavailable');
  });
});

describe('I4.1.2 — applicable manager evidence contract', () => {
  const NO_DATA_EN = 'There is not enough business information to answer that yet.';
  const ranking = () => finding({ id: 'employee_best_profit:ana', kind: 'employee_best_profit', severity: 'positive' });
  const share = () => finding({ id: 'service_share:repairs', kind: 'service_share', severity: 'information' });
  const refusal = () => finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' });
  const risk = () => finding({ id: 'customer_lost:c1', kind: 'customer_lost', severity: 'warning', data: { name: 'PEDRO', daysSinceLastVisit: 120 } });
  const opp = () => finding({ id: 'carrier_fastest_growing:att', kind: 'carrier_fastest_growing', severity: 'opportunity', data: { carrier: 'AT&T', value: 500 } });

  const engineWith = (findings: InsightFinding[]): IntelligenceEngine => ({
    getBusinessInsights: () => ({ findings, cards: [], suggestions: [], generatedForRange: RANGE }),
  } as unknown as IntelligenceEngine);

  it('helper: rankings/share/refusal are NOT applicable; risk/opportunity/up-trend ARE', () => {
    expect(hasApplicableManagerEvidence([ranking(), share(), refusal()])).toBe(false);
    expect(hasApplicableManagerEvidence([risk()])).toBe(true);
    expect(hasApplicableManagerEvidence([opp()])).toBe(true);
    expect(hasApplicableManagerEvidence([finding({ id: 'metric_trend:gross_sales', kind: 'metric_trend', severity: 'positive', data: { metric: 'gross_sales', direction: 'up' } })])).toBe(true);
  });
  it('14./16./18. only rankings or only refusals → focus terminal no-data (no fake score)', () => {
    for (const fs of [[ranking()], [refusal()], [ranking(), share()]]) {
      const r = tryHandleManagerQuestion(engineWith(fs), 'What should I focus on today?', 'en', REF)!;
      expect(r.text).toBe(NO_DATA_EN);
      expect(r.text).not.toContain('/100');
    }
  });
  it('15./17. only neutral or only refusal findings → brief terminal no-data', () => {
    expect(tryHandleManagerQuestion(engineWith([share()]), 'business brief', 'en', REF)!.text).toBe(NO_DATA_EN);
    expect(tryHandleManagerQuestion(engineWith([refusal()]), 'business brief', 'en', REF)!.text).toBe(NO_DATA_EN);
  });
  it('19./21. a supported risk still produces problem + focus responses', () => {
    const problem = tryHandleManagerQuestion(engineWith([risk()]), 'What is my biggest problem?', 'en', REF)!;
    expect(problem.text).toContain('PEDRO');
    const focus = tryHandleManagerQuestion(engineWith([risk()]), 'What should I focus on today?', 'en', REF)!;
    expect(focus.text).toContain('/100');   // real brief renders
  });
  it('20. a supported opportunity still produces an opportunity response', () => {
    const r = tryHandleManagerQuestion(engineWith([opp()]), 'What opportunity am I missing?', 'en', REF)!;
    expect(r.text).toContain('AT&T');
  });
  it('22. applicable evidence without a risk never claims "no problems" beyond evidence', () => {
    const r = tryHandleManagerQuestion(engineWith([opp()]), 'What is my biggest problem?', 'en', REF)!;
    expect(r.text).toBe('I do not have enough supported evidence to identify a business problem.');
    expect(r.text.toLowerCase()).not.toContain('no critical problems');
  });
  it('23. ES/PT applicable-no-data behavior', () => {
    expect(tryHandleManagerQuestion(engineWith([ranking()]), '¿En qué me enfoco hoy?', 'es', REF)!.text)
      .toBe('Todavía no hay suficiente información del negocio para responder eso.');
    expect(tryHandleManagerQuestion(engineWith([ranking()]), 'Em que devo focar hoje?', 'pt', REF)!.text)
      .toBe('Ainda não há informações suficientes do negócio para responder isso.');
  });
  it('28. deterministic repeated execution', () => {
    const a = tryHandleManagerQuestion(engineWith([risk()]), 'business brief', 'en', REF);
    const b = tryHandleManagerQuestion(engineWith([risk()]), 'business brief', 'en', REF);
    expect(b).toEqual(a);
  });
});

// ══ I4.1.3 — intent-specific evidence contracts ═════════════
describe('I4.1.3 — intent-specific evidence', () => {
  const NO_DATA_EN = 'There is not enough business information to answer that yet.';
  const INSUFF_PROBLEM_EN = 'I do not have enough supported evidence to identify a business problem.';
  const opp = () => finding({ id: 'carrier_fastest_growing:att', kind: 'carrier_fastest_growing', severity: 'opportunity', data: { carrier: 'AT&T', value: 500 } });
  const risk = () => finding({ id: 'customer_lost:c1', kind: 'customer_lost', severity: 'warning', data: { name: 'PEDRO', daysSinceLastVisit: 120 } });
  const upTrend = () => finding({ id: 'metric_trend:gross_sales', kind: 'metric_trend', severity: 'positive', data: { metric: 'gross_sales', direction: 'up' } });
  const ranking = () => finding({ id: 'employee_best_profit:ana', kind: 'employee_best_profit', severity: 'positive' });
  const pattern = () => finding({ id: 'customer_high_value:c1', kind: 'customer_high_value', severity: 'positive' });
  const engineWith = (findings: InsightFinding[]): IntelligenceEngine => ({
    getBusinessInsights: () => ({ findings, cards: [], suggestions: [], generatedForRange: RANGE }),
  } as unknown as IntelligenceEngine);

  it('20. helpers disagree on the SAME opportunity-only input (intent-specific)', () => {
    const fs = [opp()];
    expect(hasBriefPerformanceEvidence(fs)).toBe(false);
    expect(hasOpportunityEvidence(fs)).toBe(true);
    expect(hasProblemEvidence(fs)).toBe(false);
    expect(hasFocusEvidence(fs)).toBe(true);
  });
  it('1./2./23. one opportunity alone → NO brief, NO /100, terminal no-data (EN/ES/PT)', () => {
    const en = tryHandleManagerQuestion(engineWith([opp()]), 'business brief', 'en', REF)!;
    expect(en.text).toBe(NO_DATA_EN);
    expect(en.text).not.toContain('/100');
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'resumen del negocio', 'es', REF)!.text)
      .toBe('Todavía no hay suficiente información del negocio para responder eso.');
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'resumo do negócio', 'pt', REF)!.text)
      .toBe('Ainda não há informações suficientes do negócio para responder isso.');
  });
  it('3./4./21. opportunity-only focus → focused opportunity response (no brief/score), EN/ES/PT', () => {
    const en = tryHandleManagerQuestion(engineWith([opp()]), 'What should I focus on today?', 'en', REF)!;
    expect(en.text).toContain("Today's best focus is this opportunity:");
    expect(en.text).toContain('AT&T');
    expect(en.text).not.toContain('/100');
    expect(en.text).not.toContain('Business brief');
    expect(tryHandleManagerQuestion(engineWith([opp()]), '¿En qué me enfoco hoy?', 'es', REF)!.text)
      .toContain('El mejor enfoque para hoy es esta oportunidad:');
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'Em que devo focar hoje?', 'pt', REF)!.text)
      .toContain('O melhor foco para hoje é esta oportunidade:');
  });
  it('5./22. opportunity-only problem → insufficient-supported-problem (EN/ES/PT)', () => {
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'What is my biggest problem?', 'en', REF)!.text).toBe(INSUFF_PROBLEM_EN);
    expect(tryHandleManagerQuestion(engineWith([opp()]), '¿Cuál es mi mayor problema?', 'es', REF)!.text)
      .toBe('No tengo suficiente evidencia confiable para identificar un problema del negocio.');
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'Qual é o meu maior problema?', 'pt', REF)!.text)
      .toBe('Não tenho evidência confiável suficiente para identificar um problema do negócio.');
  });
  it('6. opportunity intent still returns the actual opportunity', () => {
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'What opportunity am I missing?', 'en', REF)!.text).toContain('AT&T');
  });
  it('7./8./9. supported risk → problem + focus + qualifies as brief performance evidence', () => {
    expect(tryHandleManagerQuestion(engineWith([risk()]), 'What is my biggest problem?', 'en', REF)!.text).toContain('PEDRO');
    expect(tryHandleManagerQuestion(engineWith([risk()]), 'What should I focus on today?', 'en', REF)!.text).toContain('/100');
    expect(hasBriefPerformanceEvidence([risk()])).toBe(true);
  });
  it('10./11. upward trend qualifies for brief; but never satisfies the opportunity intent', () => {
    expect(hasBriefPerformanceEvidence([upTrend()])).toBe(true);
    const r = tryHandleManagerQuestion(engineWith([upTrend()]), 'What opportunity am I missing?', 'en', REF)!;
    expect(r.text).toBe('No standout opportunities in this period.');
  });
  it('12.-15. refusals / rankings / neutral shares / isolated patterns alone → no brief', () => {
    const refusalOnly = [finding({ id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete', severity: 'information' })];
    const shareOnly = [finding({ id: 'service_share:repairs', kind: 'service_share', severity: 'information' })];
    for (const fs of [refusalOnly, [ranking()], shareOnly, [pattern()]]) {
      const r = tryHandleManagerQuestion(engineWith(fs), 'business brief', 'en', REF)!;
      expect(r.text).toBe(NO_DATA_EN);
      expect(r.text).not.toContain('/100');
    }
  });
  it('16./17. health: zero evaluable states insufficiency; opportunity-only stays unevaluable', () => {
    const r = tryHandleManagerQuestion(engineWith([opp()]), 'business health', 'en', REF)!;
    expect(r.text).toContain(NO_DATA_EN);
    expect(r.text).not.toMatch(/Healthy/);
  });
  it('24./26./27. recognized never null; unrecognized null; deterministic', () => {
    expect(tryHandleManagerQuestion(engineWith([]), 'business brief', 'en', REF)).not.toBeNull();
    expect(tryHandleManagerQuestion(engineWith([opp()]), 'profit this month', 'en', REF)).toBeNull();
    const a = tryHandleManagerQuestion(engineWith([opp()]), 'What should I focus on today?', 'en', REF);
    const b = tryHandleManagerQuestion(engineWith([opp()]), 'What should I focus on today?', 'en', REF);
    expect(b).toEqual(a);
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
