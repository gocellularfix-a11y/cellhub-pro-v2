// ============================================================
// CELLHUB-INTELLIGENCE-I3-1 — Business Language Engine parser tests.
//
// Table-driven, asserting the STRUCTURED parse (intent / metric / dimension /
// dateRange / comparison / language) — not merely that a regex fired. Fixed
// referenceDate makes custom-date years deterministic. No money is asserted:
// the parser describes the question, it does not compute answers.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseBusinessQuery } from './parseBusinessQuery';
import { normalizeBusinessText, foldAccents } from './normalizeBusinessText';
import type { RuntimeEntitySet } from './types';

const REF = new Date(2026, 6, 20); // 2026-07-20, local
const p = (q: string, opts = {}) => parseBusinessQuery(q, { referenceDate: REF, ...opts });

interface Expect {
  intent: string; metric?: string; dimension?: string; dateKind?: string;
  comparison?: string; lang?: string;
}
function check(q: string, e: Expect, opts = {}) {
  const r = p(q, opts);
  expect(r.intent, `intent: ${q}`).toBe(e.intent);
  if (e.metric !== undefined) expect(r.metric, `metric: ${q}`).toBe(e.metric);
  if (e.dimension !== undefined) expect(r.dimension, `dimension: ${q}`).toBe(e.dimension);
  if (e.dateKind !== undefined) expect(r.dateRange?.kind, `date: ${q}`).toBe(e.dateKind);
  if (e.comparison !== undefined) expect(r.comparison, `comparison: ${q}`).toBe(e.comparison);
  if (e.lang !== undefined) expect(r.sourceLanguage, `lang: ${q}`).toBe(e.lang);
}

describe('I3-1 — English (15+)', () => {
  const rows: Array<[string, Expect]> = [
    ['How much profit did we make today?', { intent: 'get_metric', metric: 'profit', dateKind: 'today', lang: 'en' }],
    ['What were net sales this month?', { intent: 'get_metric', metric: 'net_sales', dateKind: 'this_month', lang: 'en' }],
    ['What were gross sales yesterday?', { intent: 'get_metric', metric: 'gross_sales', dateKind: 'yesterday' }],
    ['How much did we collect in cash today?', { intent: 'get_metric', metric: 'cash', dateKind: 'today' }],
    ['Show card payments this week', { intent: 'get_metric', metric: 'card', dateKind: 'this_week' }],
    ['What is our margin this month?', { intent: 'get_metric', metric: 'margin', dateKind: 'this_month' }],
    ['How much tax did we collect last month?', { intent: 'get_metric', metric: 'net_tax', dateKind: 'last_month' }],
    ['How many transactions today?', { intent: 'get_metric', metric: 'transaction_count', dateKind: 'today' }],
    ['What is the average ticket this week?', { intent: 'get_metric', metric: 'average_ticket', dateKind: 'this_week' }],
    ['How much did we refund this month?', { intent: 'get_metric', metric: 'returns', dateKind: 'this_month' }],
    ['Which carrier sold the most this month?', { intent: 'rank_dimension', metric: 'gross_sales', dimension: 'carrier', comparison: 'highest', dateKind: 'this_month' }],
    ['Who was the top employee last week?', { intent: 'rank_dimension', dimension: 'employee', comparison: 'highest', dateKind: 'last_week' }],
    ['Which customers spent the most?', { intent: 'rank_dimension', metric: 'total_collected', dimension: 'customer', comparison: 'highest' }],
    ['Compare this month with last month net sales', { intent: 'compare_metric', metric: 'net_sales', comparison: 'between_periods' }],
    ['Show cash versus card', { intent: 'compare_metric', comparison: 'between_metrics' }],
    ['Sales by category this month', { intent: 'summarize_dimension', dimension: 'category', dateKind: 'this_month' }],
    ['Store credit collected today', { intent: 'get_metric', metric: 'store_credit', dateKind: 'today' }],
  ];
  rows.forEach(([q, e]) => it(q, () => check(q, e)));
});

describe('I3-1 — Spanish (15+)', () => {
  const rows: Array<[string, Expect]> = [
    ['¿Cuánto vendimos hoy?', { intent: 'get_metric', metric: 'gross_sales', dateKind: 'today', lang: 'es' }],
    ['¿Cuál fue la ganancia este mes?', { intent: 'get_metric', metric: 'profit', dateKind: 'this_month', lang: 'es' }],
    ['¿Cuánto cobramos en efectivo?', { intent: 'get_metric', metric: 'cash', lang: 'es' }],
    ['¿Cuáles fueron las ventas netas ayer?', { intent: 'get_metric', metric: 'net_sales', dateKind: 'yesterday' }],
    ['¿Cuál es el margen este mes?', { intent: 'get_metric', metric: 'margin', dateKind: 'this_month' }],
    ['¿Cuántas devoluciones tuvimos la semana pasada?', { intent: 'get_metric', metric: 'returns', dateKind: 'last_week' }],
    ['¿Cuánto impuesto recaudado este mes?', { intent: 'get_metric', metric: 'gross_tax', dateKind: 'this_month' }],
    ['¿Cuántas transacciones hoy?', { intent: 'get_metric', metric: 'transaction_count', dateKind: 'today' }],
    ['¿Cuál es el ticket promedio esta semana?', { intent: 'get_metric', metric: 'average_ticket', dateKind: 'this_week' }],
    ['¿Qué compañía vendió más?', { intent: 'rank_dimension', dimension: 'carrier', comparison: 'highest', lang: 'es' }],
    ['¿Qué proveedor generó más ganancia?', { intent: 'rank_dimension', metric: 'profit', dimension: 'payment_provider', comparison: 'highest' }],
    ['¿Quién fue el mejor empleado?', { intent: 'rank_dimension', dimension: 'employee', comparison: 'highest' }],
    ['¿Cuáles clientes tienen más total cobrado?', { intent: 'rank_dimension', metric: 'total_collected', dimension: 'customer', comparison: 'highest' }],
    ['¿Cuánto cobramos con tarjeta ayer?', { intent: 'get_metric', metric: 'card', dateKind: 'yesterday' }],
    ['Ventas por categoría este mes', { intent: 'summarize_dimension', dimension: 'category', dateKind: 'this_month' }],
    ['Compara este mes con el mes pasado la ganancia', { intent: 'compare_metric', metric: 'profit', comparison: 'between_periods' }],
  ];
  rows.forEach(([q, e]) => it(q, () => check(q, e)));
});

describe('I3-1 — Portuguese (15+)', () => {
  const rows: Array<[string, Expect]> = [
    ['Quanto vendemos hoje?', { intent: 'get_metric', metric: 'gross_sales', dateKind: 'today', lang: 'pt' }],
    ['Qual foi o lucro deste mês?', { intent: 'get_metric', metric: 'profit', dateKind: 'this_month', lang: 'pt' }],
    ['Quanto recebemos em dinheiro?', { intent: 'get_metric', metric: 'cash', lang: 'pt' }],
    ['Quais foram as vendas líquidas ontem?', { intent: 'get_metric', metric: 'net_sales', dateKind: 'yesterday' }],
    ['Qual é a margem deste mês?', { intent: 'get_metric', metric: 'margin', dateKind: 'this_month' }],
    ['Quantas devoluções tivemos na semana passada?', { intent: 'get_metric', metric: 'returns', dateKind: 'last_week' }],
    ['Quantas transações hoje?', { intent: 'get_metric', metric: 'transaction_count', dateKind: 'today' }],
    ['Qual foi o ticket médio esta semana?', { intent: 'get_metric', metric: 'average_ticket', dateKind: 'this_week' }],
    ['Qual operadora vendeu mais?', { intent: 'rank_dimension', dimension: 'carrier', comparison: 'highest', lang: 'pt' }],
    ['Qual categoria teve maior lucro?', { intent: 'rank_dimension', metric: 'profit', dimension: 'category', comparison: 'highest' }],
    ['Quem foi o melhor funcionário?', { intent: 'rank_dimension', dimension: 'employee', comparison: 'highest' }],
    ['Quais clientes têm maior total recebido?', { intent: 'rank_dimension', metric: 'total_collected', dimension: 'customer', comparison: 'highest' }],
    ['Quanto recebemos no cartão ontem?', { intent: 'get_metric', metric: 'card', dateKind: 'yesterday' }],
    ['Vendas por categoria neste mês', { intent: 'summarize_dimension', dimension: 'category', dateKind: 'this_month' }],
    ['Compare este mês com o mês passado o lucro', { intent: 'compare_metric', metric: 'profit', comparison: 'between_periods' }],
    ['Qual foi o custo deste mês?', { intent: 'get_metric', metric: 'cost', dateKind: 'this_month' }],
  ];
  rows.forEach(([q, e]) => it(q, () => check(q, e)));
});

describe('I3-1 — typo & normalization (10+)', () => {
  it('foldAccents strips diacritics', () => {
    expect(foldAccents('cuánto vendí hoy')).toBe('cuanto vendi hoy');
    expect(foldAccents('lucro do mês')).toBe('lucro do mes');
  });
  it('¿Cuánto vendí hoy? normalizes to accent-free', () => {
    const n = normalizeBusinessText('¿Cuánto vendí hoy?');
    expect(n.corrected).toBe('cuanto vendi hoy');
  });
  const typos: Array<[string, string]> = [
    ['revnue this month', 'gross_sales'],
    ['profitt today', 'profit'],
    ['how many transations today', 'transaction_count'],
    ['ganacia este mes', 'profit'],
    ['devolucioens este mes', 'returns'],
    ['custmer total collected', 'total_collected'],
  ];
  typos.forEach(([q, metric]) => it(`typo: ${q}`, () => {
    expect(p(q).metric).toBe(metric);
  }));
  it('provedor typo → proveedor still resolves payment_provider', () => {
    expect(p('¿qué provedor generó más?').dimension).toBe('payment_provider');
  });
  it('AT&T / ATT / at and t all resolve to the AT&T carrier', () => {
    for (const q of ['best AT&T sales', 'best ATT sales', 'best at and t sales']) {
      const r = p(q);
      expect(r.entity?.canonicalName, q).toBe('AT&T');
      expect(r.dimension, q).toBe('carrier');
    }
  });
  it('T-Mobile / t mobile / tmobile all resolve to T-Mobile', () => {
    for (const q of ['t-mobile sales today', 't mobile sales today', 'tmobile sales today']) {
      expect(p(q).entity?.canonicalName, q).toBe('T-Mobile');
    }
  });
});

describe('I3-1 — carrier vs payment-provider distinction (5)', () => {
  it('carrier keyword → carrier dimension', () => expect(p('best carrier this month').dimension).toBe('carrier'));
  it('payment provider keyword → payment_provider', () => expect(p('top payment provider this month').dimension).toBe('payment_provider'));
  it('bare "provider" → payment_provider (not carrier)', () => expect(p('which provider made the most').dimension).toBe('payment_provider'));
  it('a known carrier name → carrier entity, never payment_provider', () => {
    const r = p('how much did Verizon sell today');
    expect(r.dimension).toBe('carrier');
    expect(r.entity?.canonicalName).toBe('Verizon');
  });
  it('runtime payment provider (ePay) resolves as payment_provider, distinct from carriers', () => {
    const entities: RuntimeEntitySet = { paymentProviders: [{ id: 'pp1', name: 'ePay' }], carriers: [{ id: 'c1', name: 'AT&T' }] };
    const r = p('how much through ePay this month', { entities });
    expect(r.dimension).toBe('payment_provider');
    expect(r.entity?.canonicalName).toBe('ePay');
    expect(r.entity?.canonicalId).toBe('pp1');
  });
});

describe('I3-1 — ambiguous-metric behavior (5)', () => {
  it('bare "sales" defaults to gross_sales + records an assumption', () => {
    const r = p('how are sales today');
    expect(r.metric).toBe('gross_sales');
    expect(r.assumptions.some((a) => /gross_sales/.test(a))).toBe(true);
  });
  it('bare "revenue" → gross_sales assumption', () => {
    expect(p('what was revenue this month').assumptions.length).toBeGreaterThan(0);
  });
  it('bare "tax" → net_tax with assumption', () => {
    const r = p('how much tax today');
    expect(r.metric).toBe('net_tax');
    expect(r.assumptions.some((a) => /net_tax/.test(a))).toBe(true);
  });
  it('¿cómo están las ventas? → gross_sales default (es)', () => {
    const r = p('¿cómo están las ventas?');
    expect(r.metric).toBe('gross_sales');
    expect(r.sourceLanguage).toBe('es');
  });
  it('no date range → ambiguity recorded', () => {
    expect(p('how much profit').ambiguities.some((a) => /date range/i.test(a))).toBe(true);
  });
});

describe('I3-1 — comparison & ranking (5)', () => {
  it('rank carrier by gross sales', () => check('which carrier sold the most this month', { intent: 'rank_dimension', dimension: 'carrier', comparison: 'highest' }));
  it('lowest category by profit', () => check('which category had the lowest profit', { intent: 'rank_dimension', metric: 'profit', dimension: 'category', comparison: 'lowest' }));
  it('compare periods', () => check('compare this month with last month', { intent: 'compare_metric', comparison: 'between_periods' }));
  it('increase detection', () => expect(p('did sales increase this month').comparison).toBe('increase'));
  it('"more than" filter does not become a ranking', () => {
    const r = p('sales more than 100 today');
    expect(r.intent).toBe('get_metric');
    expect(r.comparison).toBeUndefined();
  });
});

describe('I3-1 — explicit date ranges (5)', () => {
  it('EN July 1 to July 15', () => {
    const r = p('profit from july 1 to july 15');
    expect(r.dateRange).toEqual({ kind: 'custom', startDate: '2026-07-01', endDate: '2026-07-15' });
  });
  it('ES del 1 de julio al 15 de julio', () => {
    const r = p('ganancia del 1 de julio al 15 de julio');
    expect(r.dateRange).toEqual({ kind: 'custom', startDate: '2026-07-01', endDate: '2026-07-15' });
  });
  it('PT de 1 de julho a 15 de julho', () => {
    const r = p('lucro de 1 de julho a 15 de julho');
    expect(r.dateRange).toEqual({ kind: 'custom', startDate: '2026-07-01', endDate: '2026-07-15' });
  });
  it('cross-month EN March 3 to April 10', () => {
    const r = p('sales from march 3 to april 10');
    expect(r.dateRange).toEqual({ kind: 'custom', startDate: '2026-03-03', endDate: '2026-04-10' });
  });
  it('all time', () => expect(p('all time profit').dateRange?.kind).toBe('all_time'));
});

describe('I3-1 — unknown / unsupported (5)', () => {
  const unknowns = [
    'What color should I paint the store?',
    'Tell me a joke.',
    '¿Cómo está el clima?',
    'Play some music',
    'Qual é o sentido da vida?',
  ];
  unknowns.forEach((q) => it(`unknown: ${q}`, () => {
    const r = p(q);
    expect(r.intent).toBe('unknown');
    expect(r.confidence).toBeLessThanOrEqual(0.2);
    expect(r.metric).toBeUndefined();
  }));
  it('never fabricates a confident money query from unrelated text', () => {
    for (const q of unknowns) expect(p(q).confidence).toBeLessThan(0.3);
  });
});

describe('I3-1 — contract hygiene', () => {
  it('always returns the full structured shape', () => {
    const r = p('how much profit today');
    expect(typeof r.confidence).toBe('number');
    expect(Array.isArray(r.assumptions)).toBe(true);
    expect(Array.isArray(r.ambiguities)).toBe(true);
    expect(Array.isArray(r.matchedTerms)).toBe(true);
    expect(r.normalizedText).toBe('how much profit today');
    expect(['en', 'es', 'pt']).toContain(r.sourceLanguage);
  });
  it('is deterministic', () => {
    const a = p('which carrier sold the most this month');
    const b = p('which carrier sold the most this month');
    expect(a).toEqual(b);
  });
  it('forced language option wins over detection', () => {
    expect(p('sales today', { language: 'pt' }).sourceLanguage).toBe('pt');
  });
});
