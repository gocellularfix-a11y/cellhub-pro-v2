// ============================================================
// R-INTEL-V2-PHASE6-PT-COVERAGE — routing lock.
// Phase 3 shadow diagnostics documented four Portuguese production gaps
// (all previously fallback_question):
//   'mais vendido'        → top_items       (TOP_ITEMS had no PT phrase)
//   'reparos atrasados'   → repairs_overdue (no bank matched the plural)
//   'previsão de vendas'  → forecast_items  (FORECAST had no PT phrase)
//   'ajuda'               → help            (HELP had no PT token)
// Locks: (a) the corrected phrases + natural variants route correctly,
// (b) close competing phrases are NOT stolen (follow-up/escalate/ready/
// payments), (c) representative EN/ES routing for every touched intent is
// byte-for-byte unchanged, (d) help stays maximally conservative — any
// operational hit beats it on the position tie-break.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'pt') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('PT corrections — positive routing', () => {
  it('top sellers', () => {
    expect(id('mais vendido')).toBe('top_items');
    expect(id('produtos mais vendidos')).toBe('top_items'); // plural via substring
    expect(id('qual é o mais vendido')).toBe('top_items');
  });

  it('overdue repairs (plural anchored phrase)', () => {
    expect(id('reparos atrasados')).toBe('repairs_overdue');
    expect(id('meus reparos atrasados')).toBe('repairs_overdue');
  });

  it('sales forecast', () => {
    expect(id('previsão de vendas')).toBe('forecast_items');
    expect(id('previsao de vendas')).toBe('forecast_items'); // unaccented variant
    expect(id('previsão')).toBe('forecast_items');
    expect(id('qual a previsão de vendas do mês')).toBe('forecast_items');
  });

  it('help / capabilities', () => {
    expect(id('ajuda')).toBe('help');
    expect(id('preciso de ajuda')).toBe('help');
  });
});

describe('PT corrections — collision protection', () => {
  it('a help word embedded in an operational ask never steals the intent', () => {
    // 1-1 tie: repairs_overdue sits earlier in the scores array than help.
    expect(id('me ajuda a ver os reparos atrasados')).toBe('repairs_overdue');
  });

  it('singular "reparo atrasado" keeps its pre-existing owner (repair_follow_up)', () => {
    // Deliberately NOT added to REPAIRS_KEYWORDS — locked here so a future
    // round cannot silently flip the operator-command routing.
    expect(id('reparo atrasado')).toBe('repair_follow_up');
    expect(id('acompanhar reparo atrasado')).toBe('repair_follow_up');
    expect(id('escalar reparo atrasado')).toBe('repair_escalate');
  });

  it('ready-for-pickup phrases still win (Phase 4 correction intact)', () => {
    expect(id('reparos prontos')).toBe('repairs_ready');
    expect(id('reparo pronto')).toBe('repairs_ready');
    expect(id('pronto para retirada')).toBe('repairs_ready');
  });

  it('late payments are NOT stolen by the overdue-repairs bank', () => {
    // Bare 'atrasados' was deliberately not added — the anchored phrase
    // cannot match a payments ask. (Where these DO route is pre-existing
    // behavior outside this round: 'pagamentos pendentes' goes to
    // attention_feed via its bare 'pendentes' token — documented, untouched.)
    expect(id('pagamentos atrasados')).not.toBe('repairs_overdue');
    expect(id('pagamentos pendentes')).not.toBe('repairs_overdue');
    expect(id('contas a receber')).toBe('unpaid_balances'); // AR intact
  });

  it('sales-of-today and trend asks are NOT pulled into forecast', () => {
    expect(id('vendas de hoje')).not.toBe('forecast_items');
    expect(id('tendência de vendas')).not.toBe('forecast_items');
  });

  it('other "mais …" phrases are NOT pulled into top_items', () => {
    expect(id('mais urgente')).not.toBe('top_items');
    expect(id('mais barato')).not.toBe('top_items');
  });

  it('PT conversational filler still hard-blocks before scoring', () => {
    expect(id('obrigado')).toBe('fallback_question');
  });
});

describe('EN/ES regression — touched intents byte-for-byte unchanged', () => {
  it('top_items', () => {
    expect(id('top seller', 'en')).toBe('top_items');
    expect(id('más vendido', 'es')).toBe('top_items');
    expect(id('qué vendo más', 'es')).toBe('top_items');
  });

  it('repairs_overdue', () => {
    expect(id('overdue repairs', 'en')).toBe('repairs_overdue');
    expect(id('late repairs', 'en')).toBe('repairs_overdue');
    expect(id('reparaciones atrasadas', 'es')).toBe('repairs_overdue');
  });

  it('forecast_items', () => {
    // Phase 6 locked 'expected sales' on its then-current tie loss to
    // sales_summary (out of that round's scope). R-INTEL-V2-PHASE7 closed
    // the documented tie-loss class with the forecast override — full lock
    // lives in intentRouterSalesForecast.test.ts.
    expect(id('forecast', 'en')).toBe('forecast_items');
    expect(id('expected sales', 'en')).toBe('forecast_items'); // Phase 7 correction
    expect(id('proyeccion', 'es')).toBe('forecast_items');
    expect(id('pronostico', 'es')).toBe('forecast_items');
  });

  it('help', () => {
    expect(id('help', 'en')).toBe('help');
    expect(id('what can you do', 'en')).toBe('help');
    expect(id('ayuda', 'es')).toBe('help');
  });
});
