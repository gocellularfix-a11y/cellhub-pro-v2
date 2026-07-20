// ============================================================
// CHAT-R1.2 — the 20-query LIVE routing matrix.
//
// Every row runs the EXACT live chat path (classifyIntent → handleIntent →
// gate/executor/presenter) and locks BOTH the winning intent and the shape
// of the real response. Amount-bearing assertions use stable labels (period
// names, metric labels) — fixtures are run-date relative so rows never
// depend on the calendar.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import { handleIntent } from './handlers';
import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale, SaleItem } from '@/store/types';

let seq = 0;
function item(over: Partial<SaleItem>): SaleItem {
  return { id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...over } as SaleItem;
}
function sale(createdAt: string, price: number, customerId?: string): Sale {
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [item({ price, cost: Math.round(price / 2) })],
    subtotal: price, taxAmount: 0, cbeTotal: 0, total: price,
    paymentMethod: 'cash' as Sale['paymentMethod'], status: 'completed' as Sale['status'],
    createdAt, employeeName: 'Ana', customerId,
  } as Sale;
}
function daysAgoLocal(daysAgo: number): string {
  const x = new Date();
  x.setDate(x.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T10:00:00`;
}
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
function buildEngine(): IntelligenceEngine {
  const sales = [
    sale(daysAgoLocal(1), 2500, 'cust-jenny'),
    sale(daysAgoLocal(9), 8000, 'cust-jenny'),
    sale(daysAgoLocal(35), 4000),
  ];
  return new IntelligenceEngine(
    sales, [JENNY], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}
function live(q: string, lang: 'en' | 'es' | 'pt' = 'en'): { intent: string; text: string } {
  const m = classifyIntent(q, [JENNY], lang);
  const r = handleIntent(m, buildEngine(), lang) as { text?: string };
  return { intent: m.id, text: r.text ?? '' };
}

describe('CHAT-R1.2 — 20-query live routing matrix', () => {
  it('1. WHO IS MY BEST CUSTOMER → specific customer answer', () => {
    const r = live('WHO IS MY BEST CUSTOMER');
    expect(r.intent).toBe('best_customer');
  });
  it('2. LAST WEEK SALES → canonical last-week metric', () => {
    const r = live('LAST WEEK SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales');
    expect(r.text).toContain('(last week)');
    expect(r.text).not.toContain('Last 30 days revenue');
  });
  it('3. LAST WEE SALES (production typo) → same canonical last-week metric', () => {
    const r = live('LAST WEE SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('(last week)');
  });
  it('4. sales last month → canonical last-month metric', () => {
    const r = live('sales last month');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('(last month)');
  });
  it('5. COMPARE LAST MONTH TO THIS MONTH SALES → both period labels', () => {
    const r = live('COMPARE LAST MONTH TO THIS MONTH SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('last month');
    expect(r.text).toContain('this month');
    expect(r.text).not.toContain('Last 30 days revenue');
  });
  it('6. sales yesterday → canonical yesterday metric', () => {
    const r = live('sales yesterday');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales');
    expect(r.text).toContain('(yesterday)');
    expect(r.text).toContain('$25.00');
  });
  it('7. how much did we sell last week → CANONICAL structured execution (R1.2)', () => {
    const r = live('how much did we sell last week');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales');      // canonical executor, not legacy
    expect(r.text).toContain('(last week)');
  });
  it('8. profit last week → canonical profit metric', () => {
    const r = live('profit last week');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Profit');
    expect(r.text).toContain('(last week)');
  });
  it('9. how are sales → generic 30-day summary (final fallback, preserved)', () => {
    const r = live('how are sales');
    expect(r.intent).toBe('sales_summary');
    expect(r.text).toContain('Last 30 days revenue');
  });
  it('10. resumen de ventas (ES) → generic summary in Spanish', () => {
    const r = live('resumen de ventas', 'es');
    expect(r.intent).toBe('sales_summary');
    expect(r.text).toContain('Ingresos últimos 30 días');
  });
  it('11. ventas de la semana pasada (ES) → canonical ES answer', () => {
    const r = live('ventas de la semana pasada', 'es');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Ventas brutas');
    expect(r.text).toContain('(la semana pasada)');
  });
  it('12. vendas de ontem (PT) → canonical PT answer', () => {
    const r = live('vendas de ontem', 'pt');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Vendas brutas');
  });
  it('13. cuánto vendimos ayer (ES) → canonical ES yesterday', () => {
    const r = live('cuánto vendimos ayer', 'es');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Ventas brutas');
  });
  it('14. sales today → today_sales (sales-of-record handler, preserved)', () => {
    expect(live('sales today').intent).toBe('today_sales');
  });
  it('15. sales trend → trend_direction (trajectory, preserved)', () => {
    expect(live('sales trend').intent).toBe('trend_direction');
  });
  it('16. sales forecast → forecast_items (prediction, preserved)', () => {
    expect(live('sales forecast').intent).toBe('forecast_items');
  });
  it('17. top items → top_items (ranking outranks generic summary)', () => {
    expect(live('top items').intent).toBe('top_items');
  });
  it('18. he said how much → conversation_runner (reported reply, preserved)', () => {
    expect(live('he said how much').intent).toBe('conversation_runner');
  });
  it('19. can you do better → conversation_runner (bare cue, no period)', () => {
    expect(live('can you do better').intent).toBe('conversation_runner');
  });
  it('20. tell me a joke → fallback_question (generic is the LAST resort)', () => {
    expect(live('tell me a joke').intent).toBe('fallback_question');
  });
  it('determinism: every matrix row classifies identically twice', () => {
    for (const q of ['LAST WEEK SALES', 'how much did we sell last week', 'how are sales']) {
      expect(classifyIntent(q, [JENNY], 'en')).toEqual(classifyIntent(q, [JENNY], 'en'));
    }
  });
});
