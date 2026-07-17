// ============================================================
// CELLHUB-INTELLIGENCE-I3-1.1 — two-operand comparison contract tests.
//
// Asserts the FULL structured operands (not just intent/comparison) for
// metric-vs-metric, entity-vs-entity (static + runtime), period-vs-period,
// combined metric/entity, explicit-year date ranges, and the tightened
// bare-ranking guards. Fixed referenceDate for deterministic custom years.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseBusinessQuery } from './parseBusinessQuery';
import type { RuntimeEntitySet } from './types';

const REF = new Date(2026, 6, 20);
const p = (q: string, opts = {}) => parseBusinessQuery(q, { referenceDate: REF, ...opts });

const ENTITIES: RuntimeEntitySet = {
  paymentProviders: [{ id: 'pp-epay', name: 'ePay' }, { id: 'pp-vida', name: 'VidaPay' }],
  employees: [{ id: 'emp-ana', name: 'Ana' }, { id: 'emp-luis', name: 'Luis' }],
  stores: [{ id: 'st-dt', name: 'Downtown' }, { id: 'st-n', name: 'North' }],
  categories: [{ id: 'cat-a', name: 'Category A' }, { id: 'cat-b', name: 'Category B' }],
};

describe('I3-1.1 — two-metric comparisons (1-5)', () => {
  it('1. cash versus card', () => {
    const r = p('Show cash versus card.');
    expect(r.intent).toBe('compare_metric');
    expect(r.comparison).toBe('between_metrics');
    expect(r.comparisonOperands).toEqual({ left: { metric: 'cash' }, right: { metric: 'card' } });
    expect(r.metric).toBeUndefined();
  });
  it('2. gross sales versus net sales', () => {
    const r = p('gross sales versus net sales this month');
    expect(r.comparison).toBe('between_metrics');
    expect(r.comparisonOperands?.left.metric).toBe('gross_sales');
    expect(r.comparisonOperands?.right.metric).toBe('net_sales');
    expect(r.dateRange?.kind).toBe('this_month');
  });
  it('3. profit versus cost', () => {
    expect(p('profit versus cost').comparisonOperands).toEqual({ left: { metric: 'profit' }, right: { metric: 'cost' } });
  });
  it('4. efectivo contra tarjeta', () => {
    const r = p('efectivo contra tarjeta');
    expect(r.comparison).toBe('between_metrics');
    expect(r.comparisonOperands).toEqual({ left: { metric: 'cash' }, right: { metric: 'card' } });
  });
  it('5. dinheiro versus cartao', () => {
    const r = p('dinheiro versus cartão');
    expect(r.comparison).toBe('between_metrics');
    expect(r.comparisonOperands?.left.metric).toBe('cash');
    expect(r.comparisonOperands?.right.metric).toBe('card');
  });
});

describe('I3-1.1 — two-entity comparisons (6-10)', () => {
  it('6. AT&T versus Verizon', () => {
    const r = p('Compare AT&T versus Verizon this month');
    expect(r.comparison).toBe('between_entities');
    expect(r.dimension).toBe('carrier');
    expect(r.comparisonOperands?.left.entity?.canonicalName).toBe('AT&T');
    expect(r.comparisonOperands?.right.entity?.canonicalName).toBe('Verizon');
    expect(r.dateRange?.kind).toBe('this_month');
  });
  it('7. ePay versus VidaPay (runtime payment providers, ids preserved)', () => {
    const r = p('ePay versus VidaPay', { entities: ENTITIES });
    expect(r.comparison).toBe('between_entities');
    expect(r.dimension).toBe('payment_provider');
    expect(r.comparisonOperands?.left.entity).toMatchObject({ canonicalId: 'pp-epay', canonicalName: 'ePay', type: 'payment_provider' });
    expect(r.comparisonOperands?.right.entity).toMatchObject({ canonicalId: 'pp-vida', canonicalName: 'VidaPay' });
  });
  it('8. repairs versus unlocks (service entities)', () => {
    const r = p('Compare repairs with unlocks this month');
    expect(r.comparison).toBe('between_entities');
    expect(r.dimension).toBe('service');
    expect(r.comparisonOperands?.left.entity?.canonicalName).toBe('repair');
    expect(r.comparisonOperands?.right.entity?.canonicalName).toBe('unlock');
  });
  it('9. Employee Ana versus Employee Luis', () => {
    const r = p('Employee Ana versus Employee Luis', { entities: ENTITIES });
    expect(r.dimension).toBe('employee');
    expect(r.comparisonOperands?.left.entity?.canonicalId).toBe('emp-ana');
    expect(r.comparisonOperands?.right.entity?.canonicalId).toBe('emp-luis');
  });
  it('10. two configured stores', () => {
    const r = p('Store Downtown versus Store North', { entities: ENTITIES });
    expect(r.dimension).toBe('store');
    expect(r.comparisonOperands?.left.entity?.canonicalId).toBe('st-dt');
    expect(r.comparisonOperands?.right.entity?.canonicalId).toBe('st-n');
  });
});

describe('I3-1.1 — two-period comparisons (11-14)', () => {
  it('11. this month versus last month', () => {
    const r = p('compare this month versus last month');
    expect(r.comparison).toBe('between_periods');
    expect(r.comparisonOperands).toEqual({ left: { dateRange: { kind: 'this_month' } }, right: { dateRange: { kind: 'last_month' } } });
    expect(r.dateRange).toBeUndefined();
  });
  it('12. this week versus last week', () => {
    const r = p('compare this week versus last week');
    expect(r.comparison).toBe('between_periods');
    expect(r.comparisonOperands?.left.dateRange?.kind).toBe('this_week');
    expect(r.comparisonOperands?.right.dateRange?.kind).toBe('last_week');
  });
  it('13. este mes contra el mes pasado', () => {
    const r = p('compara este mes contra el mes pasado');
    expect(r.comparison).toBe('between_periods');
    expect(r.comparisonOperands?.left.dateRange?.kind).toBe('this_month');
    expect(r.comparisonOperands?.right.dateRange?.kind).toBe('last_month');
  });
  it('14. este mes contra o mes passado (pt) + lucro', () => {
    const r = p('compare este mês contra o mês passado o lucro');
    expect(r.comparison).toBe('between_periods');
    expect(r.metric).toBe('profit');
    expect(r.comparisonOperands?.left.dateRange?.kind).toBe('this_month');
    expect(r.comparisonOperands?.right.dateRange?.kind).toBe('last_month');
  });
});

describe('I3-1.1 — combined metric/entity comparisons (15-17)', () => {
  it('15. AT&T profit versus Verizon profit', () => {
    const r = p('Compare AT&T profit versus Verizon profit this month');
    expect(r.comparison).toBe('between_entities');
    expect(r.metric).toBe('profit');
    expect(r.dimension).toBe('carrier');
    expect(r.comparisonOperands?.left.entity?.canonicalName).toBe('AT&T');
    expect(r.comparisonOperands?.right.entity?.canonicalName).toBe('Verizon');
    expect(r.dateRange?.kind).toBe('this_month');
  });
  it('16. ganancia de AT&T contra Verizon', () => {
    const r = p('ganancia de AT&T contra Verizon');
    expect(r.comparison).toBe('between_entities');
    expect(r.metric).toBe('profit');
    expect(r.dimension).toBe('carrier');
  });
  it('17. lucro da Operadora A versus Operadora B (runtime carriers)', () => {
    const entities: RuntimeEntitySet = { carriers: [{ id: 'ca', name: 'Operadora A' }, { id: 'cb', name: 'Operadora B' }] };
    const r = p('lucro da Operadora A versus Operadora B', { entities });
    expect(r.comparison).toBe('between_entities');
    expect(r.metric).toBe('profit');
    expect(r.comparisonOperands?.left.entity?.canonicalId).toBe('ca');
    expect(r.comparisonOperands?.right.entity?.canonicalId).toBe('cb');
  });
});

describe('I3-1.1 — explicit-year date ranges (18-23)', () => {
  const R = { kind: 'custom', startDate: '2025-07-01', endDate: '2025-07-15' };
  it('18. EN July 1, 2025 to July 15, 2025', () => expect(p('profit july 1, 2025 to july 15, 2025').dateRange).toEqual(R));
  it('19. EN shared ending year: July 1 to July 15, 2025', () => expect(p('sales july 1 to july 15, 2025').dateRange).toEqual(R));
  it('20. ES del 1 de julio de 2025 al 15 de julio de 2025', () => expect(p('ganancia del 1 de julio de 2025 al 15 de julio de 2025').dateRange).toEqual(R));
  it('21. ES shared month+year: del 1 al 15 de julio de 2025', () => expect(p('ganancia del 1 al 15 de julio de 2025').dateRange).toEqual(R));
  it('22. PT de 1 de julho de 2025 a 15 de julho de 2025', () => expect(p('lucro de 1 de julho de 2025 a 15 de julho de 2025').dateRange).toEqual(R));
  it('23. PT shared: de 1 a 15 de julho de 2025', () => expect(p('lucro de 1 a 15 de julho de 2025').dateRange).toEqual(R));
  it('no-year still uses referenceDate (2026)', () => {
    expect(p('profit july 1 to july 15').dateRange).toEqual({ kind: 'custom', startDate: '2026-07-01', endDate: '2026-07-15' });
  });
  it('rejects an impossible date (Feb 30)', () => {
    expect(p('sales february 1 to february 30, 2025').dateRange?.kind).not.toBe('custom');
  });
});

describe('I3-1.1 — ranking-word guards (24-27)', () => {
  const notRank = (q: string) => {
    const r = p(q);
    expect(r.intent, q).not.toBe('rank_dimension');
    expect(r.comparison === 'highest' || r.comparison === 'lowest', q).toBe(false);
  };
  it('24. Ganamos mas este mes', () => notRank('Ganamos más este mes'));
  it('25. Vendimos menos ayer', () => notRank('Vendimos menos ayer'));
  it('26. Mas de 10 transacciones', () => notRank('Más de 10 transacciones'));
  it('27. Menos de 5 reparaciones', () => notRank('Menos de 5 reparaciones'));
  it('valid ranking still works (es)', () => {
    const r = p('¿Qué compañía vendió más?');
    expect(r.intent).toBe('rank_dimension');
    expect(r.comparison).toBe('highest');
    expect(r.dimension).toBe('carrier');
  });
  it('valid ranking still works (pt)', () => {
    expect(p('Qual operadora vendeu mais?').intent).toBe('rank_dimension');
  });
});

describe('I3-1.1 — carrier statics vs runtime providers stay separate', () => {
  it('a runtime provider does not leak into carrier resolution', () => {
    const r = p('ePay versus VidaPay', { entities: ENTITIES });
    expect(r.dimension).toBe('payment_provider');
    expect(r.comparisonOperands?.left.entity?.type).toBe('payment_provider');
  });
  it('a static carrier resolves without runtime data', () => {
    const r = p('AT&T versus Verizon');
    expect(r.comparisonOperands?.left.entity?.type).toBe('carrier');
    expect(r.comparisonOperands?.left.entity?.canonicalId).toBeUndefined(); // static → no id
  });
});
