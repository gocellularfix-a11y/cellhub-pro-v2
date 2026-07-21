// ============================================================
// CHAT-R1.5 — comparison-scope and product-aggregation edge cases.
//
// Locks the two selective-truth rules through the LIVE gate
// (tryHandleStructuredBusinessQuery — the exact entry handlers.ts calls):
//   1. current/previous normalization applies ONLY to recognized pairs
//      (today/yesterday, this_week/last_week, this_month/last_month) —
//      arbitrary combinations keep the user's utterance order;
//   2. product rankings aggregate ONLY qualifying merchandise LINES from
//      the requested scope — a name sold both as product and as a
//      service/payment line ranks with its product revenue only.
// ============================================================

import { describe, it, expect } from 'vitest';
import { tryHandleStructuredBusinessQuery } from './tryHandleStructuredBusinessQuery';
import { clearAnalyticalContext } from './analyticalContext';
import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale, SaleItem } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);   // Wed 2026-07-15

let seq = 0;
const item = (o: Partial<SaleItem> & { portal?: string }): SaleItem =>
  ({ id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...o } as SaleItem);
const sale = (createdAt: string, items: SaleItem[], total: number): Sale =>
  ({ id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items, subtotal: total, taxAmount: 0, cbeTotal: 0, total,
     paymentMethod: 'cash', status: 'completed', createdAt, employeeName: 'Ana' } as unknown as Sale);

function buildEngine(): IntelligenceEngine {
  const sales = [
    sale('2026-07-15T10:00:00', [item({ name: 'Case', price: 2500, cost: 1000 })], 2500),                 // today
    sale('2026-07-14T10:00:00', [item({ name: 'Charger', price: 8000, cost: 3000 })], 8000),              // yesterday
    // last week: merchandise + a MIXED-NAME service line + a phone payment
    sale('2026-07-08T10:00:00', [item({ name: 'Charger', price: 12000, cost: 4000 })], 12000),
    sale('2026-07-08T12:00:00', [item({ name: 'Combo Pack', price: 3000, cost: 1000 })], 3000),           // product line
    sale('2026-07-09T10:00:00', [item({ name: 'Combo Pack', category: 'service' as SaleItem['category'], price: 5000 })], 5000),   // SAME NAME as service
    sale('2026-07-09T11:00:00', [item({ name: 'AT&T - 8054445555', category: 'phone_payment' as SaleItem['category'], price: 6500, carrier: 'AT&T', portal: 'ePay' })], 6500),
    sale('2026-06-10T10:00:00', [item({ name: 'Case', price: 4000, cost: 1500 })], 4000),                 // last month
  ];
  return new IntelligenceEngine(
    sales, [] as Customer[], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}
const gate = (q: string): string => {
  clearAnalyticalContext();
  return tryHandleStructuredBusinessQuery(buildEngine(), q, 'en', REF)?.text ?? '<<null>>';
};

describe('CHAT-R1.5 — selective current/previous normalization', () => {
  it('recognized pairs answer current-vs-previous in BOTH utterance orders (today/yesterday)', () => {
    const a = gate('compare today to yesterday sales');
    const b = gate('compare yesterday to today sales');
    expect(a).toContain('today: $25.00 · yesterday: $80.00');
    expect(a).toContain('Difference: -$55.00 (-68.7%)');
    expect(b).toBe(a);   // normalization makes both utterances identical
  });
  it('recognized week pair normalizes in both orders', () => {
    const a = gate('compare this week to last week sales');
    const b = gate('compare last week to this week sales');
    expect(a).toContain('this week: $105.00 · last week: $265.00');
    expect(b).toBe(a);
  });
  it('ARBITRARY mixed-granularity combinations keep the utterance order', () => {
    const a = gate('compare this week to last month sales');
    expect(a).toContain('this week: $105.00 · last month: $40.00');
    expect(a).toContain('Difference: $65.00 (+162.5%)');
    const b = gate('compare last month to this week sales');
    expect(b).toContain('last month: $40.00 · this week: $105.00');
    expect(b).toContain('Difference: -$65.00 (-61.9%)');   // left − right, as spoken
    expect(b).not.toBe(a);
  });
  it('no NaN/Infinity in any comparison shape', () => {
    for (const q of ['compare today to yesterday sales', 'compare this week to last month sales']) {
      expect(gate(q)).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe('CHAT-R1.5 — product rankings aggregate qualifying lines only', () => {
  it('a mixed-name item ranks with its PRODUCT revenue only (never the service part)', () => {
    const text = gate('best selling product last week');
    expect(text).toContain('Combo Pack — $30.00');            // product line only
    expect(text).not.toContain('Combo Pack — $80.00');        // never product+service merged
    expect(text).not.toContain('Combo Pack — $50.00');        // never the service line
  });
  it('payment/service lines never rank; merchandise keeps ranking', () => {
    const text = gate('best selling product last week');
    expect(text).toContain('1. Charger — $120.00');
    expect(text).not.toContain('AT&T - 8054445555');
  });
  it('scope truth: the same query for last month ranks only that period', () => {
    const text = gate('best selling product last month');
    expect(text).toContain('Case — $40.00');
    expect(text).not.toContain('Charger');
    expect(text).not.toContain('Combo Pack');
  });
  it('gross_sales metric totals still include ALL lines (only PRODUCT RANKINGS are line-scoped)', () => {
    expect(gate('sales last week')).toContain('Gross sales: $265.00 (last week)');
  });
  it('deterministic repeated execution', () => {
    expect(gate('best selling product last week')).toBe(gate('best selling product last week'));
  });
});
