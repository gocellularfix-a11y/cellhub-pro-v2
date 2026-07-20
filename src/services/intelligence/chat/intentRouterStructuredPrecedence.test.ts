// ============================================================
// CELLHUB-INTELLIGENCE-CHAT-R1 — structured routing precedence.
//
// Locks the two corrections of the routing-precedence audit:
//   1. Explicit metric+period / comparison sales asks route to data_query
//      (whose handler runs manager check → structured I3-2 gate → legacy),
//      instead of being stolen by the generic last-30-days sales_summary.
//      The I3-1 parser is the single specificity source — plain summary
//      asks (no explicit range) keep their locked sales_summary routing.
//   2. data_query carries match.query. Without it, every scored data_query
//      reached handlers with '' — the structured gate NEVER ran in live
//      chat and the legacy handler answered "No data found".
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import { handleIntent } from './handlers';
import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale, SaleItem } from '@/store/types';

const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, [], lang).id;

// ══ Router precedence (pure, deterministic) ═════════════════
describe('CHAT-R1 — explicit period/comparison outranks the generic summary', () => {
  it('EN period-specific sales asks route to data_query (QA evidence class)', () => {
    for (const q of [
      'last week sales', 'sales last week', 'LAST WEEK SALES',
      'sales this month', 'this month sales', 'sales last month',
      'yesterday sales', 'sales yesterday',
      'revenue last week', 'profit last week', 'show me sales last week',
    ]) {
      expect(id(q), q).toBe('data_query');
    }
  });
  it('explicit comparison asks route to data_query (QA evidence)', () => {
    expect(id('compare last month to this month sales')).toBe('data_query');
    expect(id('compare this month with last month net sales')).toBe('data_query');
  });
  it('ES period-specific asks route to data_query', () => {
    expect(id('ventas de la semana pasada', 'es')).toBe('data_query');
    expect(id('ventas del mes pasado', 'es')).toBe('data_query');
  });
  it('plain summary asks KEEP their locked generic routing (no explicit range parsed)', () => {
    expect(id('how are sales')).toBe('sales_summary');
    expect(id('resumen de ventas', 'es')).toBe('sales_summary');
    expect(id('total sales')).toBe('sales_summary');
    expect(id('week sales')).toBe('sales_summary');       // bare period word ≠ explicit range
    expect(id('month sales')).toBe('sales_summary');
    expect(id('last wee sales')).toBe('sales_summary');   // unparseable typo → honest generic
  });
  it('neighboring precedence overrides keep their intents (forecast/trend/today)', () => {
    expect(id('sales forecast')).toBe('forecast_items');
    expect(id('sales trend')).toBe('trend_direction');
    expect(id('sales today')).toBe('today_sales');
  });
  it('deterministic repeated classification', () => {
    const a = classifyIntent('last week sales', [], 'en');
    const b = classifyIntent('last week sales', [], 'en');
    expect(b).toEqual(a);
  });
});

// ══ Gate wiring: data_query carries the raw query ═══════════
describe('CHAT-R1 — data_query carries match.query to the handler chain', () => {
  it('scored data_query and rerouted data_query both carry the query', () => {
    const scored = classifyIntent('sales yesterday', [], 'en');
    expect(scored.id).toBe('data_query');
    expect(scored.query).toBe('sales yesterday');
    const rerouted = classifyIntent('last week sales', [], 'en');
    expect(rerouted.id).toBe('data_query');
    expect(rerouted.query).toBe('last week sales');
  });
});

// ══ Live pipeline end-to-end (classifyIntent → handleIntent) ═
let seq = 0;
function item(over: Partial<SaleItem>): SaleItem {
  return { id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...over } as SaleItem;
}
function sale(createdAt: string, price: number): Sale {
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [item({ price, cost: Math.round(price / 2) })],
    subtotal: price, taxAmount: 0, cbeTotal: 0, total: price,
    paymentMethod: 'cash' as Sale['paymentMethod'], status: 'completed' as Sale['status'],
    createdAt, employeeName: 'Ana',
  } as Sale;
}
// Run-date independent fixtures: local-day stamps relative to "now".
function daysAgoLocal(daysAgo: number): string {
  const x = new Date();
  x.setDate(x.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T10:00:00`;
}
function buildEngine(): IntelligenceEngine {
  const sales = [sale(daysAgoLocal(1), 2500), sale(daysAgoLocal(9), 8000), sale(daysAgoLocal(35), 4000)];
  return new IntelligenceEngine(
    sales, [] as Customer[], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}
const answer = (q: string, lang: 'en' | 'es' | 'pt' = 'en'): string =>
  (handleIntent(classifyIntent(q, [], lang), buildEngine(), lang) as { text: string }).text;

describe('CHAT-R1 — live pipeline never hijacks period asks with the 30-day summary', () => {
  const QA_EVIDENCE = [
    'last week sales', 'LAST WEEK SALES', 'sales yesterday', 'yesterday sales',
    'sales last month', 'compare last month to this month sales',
  ];
  it('QA-evidence queries answer without the rolling summary or the empty-query dead end', () => {
    for (const q of QA_EVIDENCE) {
      const text = answer(q);
      expect(text, q).not.toContain('Last 30 days revenue');
      expect(text, q).not.toContain('No data found for that question');
    }
  });
  it('"sales yesterday" answers the exact yesterday metric', () => {
    const text = answer('sales yesterday');
    expect(text).toContain('Gross sales');
    expect(text).toContain('(yesterday)');
    expect(text).toContain('$25.00');
  });
  it('month comparison answers with BOTH period labels', () => {
    const text = answer('compare last month to this month sales');
    expect(text).toContain('last month');
    expect(text).toContain('this month');
  });
  it('ES period ask answers in Spanish without the generic summary', () => {
    const text = answer('ventas de ayer', 'es');
    expect(text).not.toContain('Ingresos últimos 30 días');
    expect(text).not.toMatch(/Last 30 days/);
  });
  it('plain "how are sales" still answers with the generic 30-day summary', () => {
    expect(answer('how are sales')).toContain('Last 30 days revenue');
  });
});
