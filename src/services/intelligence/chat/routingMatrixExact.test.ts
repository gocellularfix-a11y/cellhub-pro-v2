// ============================================================
// CHAT-R1.3 — the EXACT required 20-query routing matrix.
//
// Every row runs the REAL live pipeline (classifyIntent → handleIntent →
// manager/structured/legacy handler → executor → presenter) under a FIXED
// system time (2026-07-15) and a rich deterministic fixture, so every
// amount, label and route is exact and calendar-independent.
//
// Complements (never replaces) routingMatrix20 / structuredPrecedence /
// terminality suites.
// ============================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { classifyIntent } from './intentRouter';
import { handleIntent } from './handlers';
import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale, SaleItem } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);   // Wed 2026-07-15 — explicit stable reference

let seq = 0;
const item = (o: Partial<SaleItem> & { portal?: string }): SaleItem =>
  ({ id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...o } as SaleItem);
const sale = (createdAt: string, over: Partial<Sale>): Sale =>
  ({ id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [], subtotal: over.total ?? 0, taxAmount: 0, cbeTotal: 0,
     paymentMethod: 'cash', status: 'completed', createdAt, employeeName: 'Ana', ...over } as unknown as Sale);
const C = (id: string, name: string, phone: string): Customer => ({ id, name, phone } as unknown as Customer);

// 5 customers (Top-5 coverage), differing lifetime spend and visit counts.
const CUSTOMERS = [
  C('c-jenny', 'JENNY MIRANDA', '8054523932'),
  C('c-carlos', 'CARLOS PEREZ', '8051112222'),
  C('c-maria', 'MARIA LOPEZ', '8052223333'),
  C('c-pedro', 'PEDRO GOMEZ', '8053334444'),
  C('c-lucia', 'LUCIA TORRES', '8054445555'),
];

// Sales across today / yesterday / this week / last week / this month /
// last month, two carriers (AT&T, Verizon), two products with different
// units/revenue, and item costs for canonical profit.
function buildSales(): Sale[] {
  return [
    sale('2026-07-15T10:00:00', { customerId: 'c-jenny', items: [item({ name: 'Case', price: 2500, cost: 1000 })], total: 2500 }),
    sale('2026-07-14T10:00:00', { customerId: 'c-maria', items: [item({ name: 'Charger', price: 8000, cost: 3000 })], total: 8000 }),
    sale('2026-07-13T10:00:00', { customerId: 'c-pedro', items: [item({ name: 'Screen Protector', price: 1500, cost: 500 })], total: 1500 }),
    sale('2026-07-08T10:00:00', { customerId: 'c-jenny', items: [item({ name: 'Charger', price: 12000, cost: 4000 })], total: 12000 }),
    sale('2026-07-09T11:00:00', { customerId: 'c-lucia', items: [item({ name: 'AT&T - 8054445555', category: 'phone_payment' as SaleItem['category'], price: 6500, carrier: 'AT&T', portal: 'ePay' })], subtotal: 6500, total: 6500 }),
    sale('2026-07-03T10:00:00', { customerId: 'c-jenny', items: [item({ name: 'Verizon - 8054523932', category: 'phone_payment' as SaleItem['category'], price: 6000, carrier: 'Verizon', portal: 'VidaPay' })], subtotal: 6000, total: 6000 }),
    sale('2026-06-10T10:00:00', { customerId: 'c-carlos', items: [item({ name: 'Case', price: 4000, cost: 1500 })], total: 4000 }),
    sale('2026-06-20T10:00:00', { customerId: 'c-jenny', items: [item({ name: 'Cable', price: 9000, cost: 3500 })], total: 9000 }),
    sale('2026-06-05T10:00:00', { customerId: 'c-jenny', items: [item({ name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'], price: 6500, carrier: 'AT&T', portal: 'ePay' })], subtotal: 6500, total: 6500 }),
  ];
}

const SETTINGS = {
  defaultCommissionRate: 0.07,
  carrierCommissions: { 'AT&T': 0.10, 'Verizon': 0.07 },
  paymentPortals: [
    { id: 'ePay', name: 'ePay', label: 'ePay', emoji: '', color: '', matchCarriers: [], matchUrlSnippets: [] },
    { id: 'VidaPay', name: 'VidaPay', label: 'VidaPay', emoji: '', color: '', matchCarriers: [], matchUrlSnippets: [] },
  ],
};

function buildEngine(): IntelligenceEngine {
  return new IntelligenceEngine(
    buildSales(), CUSTOMERS, [], [],
    { lang: 'en', enableAlerts: false, enableScoring: true, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: SETTINGS } as never,
  );
}
function live(q: string): { intent: string; text: string } {
  const m = classifyIntent(q, CUSTOMERS, 'en');
  const r = handleIntent(m, buildEngine(), 'en') as { text?: string };
  return { intent: m.id, text: r.text ?? '' };
}
/** Rows 2–15/18 guard: never the generic 30-day summary substitution. */
function expectNoGenericSummary(text: string, q: string) {
  expect(text, q).not.toContain('Last 30 days');
  expect(text, q).not.toContain('Top seller');
}

beforeAll(() => { vi.useFakeTimers({ now: REF }); });
afterAll(() => { vi.useRealTimers(); });

describe('CHAT-R1.3 — exact required 20-query matrix (live pipeline)', () => {
  it('1. WHO IS MY BEST CUSTOMER → named fixture customer', () => {
    const r = live('WHO IS MY BEST CUSTOMER');
    expect(r.intent).toBe('best_customer');
    expect(r.text).toContain('JENNY MIRANDA');
  });
  it('2. LAST WEEK SALES → exact period, $185.00', () => {
    const r = live('LAST WEEK SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $185.00 (last week)');
    expectNoGenericSummary(r.text, 'LAST WEEK SALES');
  });
  it('3. LAST WEE SALES (typo) → same exact last-week answer', () => {
    const r = live('LAST WEE SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $185.00 (last week)');
    expectNoGenericSummary(r.text, 'LAST WEE SALES');
  });
  it('4. SALES LAST WEEK → exact period', () => {
    const r = live('SALES LAST WEEK');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $185.00 (last week)');
    expectNoGenericSummary(r.text, 'SALES LAST WEEK');
  });
  it('5. THIS WEEK SALES → exact period, $120.00', () => {
    const r = live('THIS WEEK SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $120.00 (this week)');
    expectNoGenericSummary(r.text, 'THIS WEEK SALES');
  });
  it('6. LAST MONTH SALES → exact period, $195.00', () => {
    const r = live('LAST MONTH SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $195.00 (last month)');
    expectNoGenericSummary(r.text, 'LAST MONTH SALES');
  });
  it('7. THIS MONTH SALES → exact period, $365.00', () => {
    const r = live('THIS MONTH SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $365.00 (this month)');
    expectNoGenericSummary(r.text, 'THIS MONTH SALES');
  });
  it('8. YESTERDAY SALES → exact period, $80.00', () => {
    const r = live('YESTERDAY SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Gross sales: $80.00 (yesterday)');
    expectNoGenericSummary(r.text, 'YESTERDAY SALES');
  });
  it('9. TODAY SALES → today sales-of-record, $25.00', () => {
    const r = live('TODAY SALES');
    expect(r.intent).toBe('today_sales');
    expect(r.text).toContain("Today's sales");
    expect(r.text).toContain('$25.00');
    // Today's own top-seller line is RELATED (today-scoped) — only the
    // 30-day rolling summary is the forbidden substitution here.
    expect(r.text).not.toContain('Last 30 days');
  });
  it('10. COMPARE LAST MONTH TO THIS MONTH SALES → current-vs-previous business direction (R1.4)', () => {
    const r = live('COMPARE LAST MONTH TO THIS MONTH SALES');
    expect(r.intent).toBe('data_query');
    // Business semantics regardless of utterance order: CURRENT first,
    // difference = current − previous → growth is POSITIVE.
    expect(r.text).toContain('this month: $365.00 · last month: $195.00');
    expect(r.text).toContain('Difference: +$170.00 (+87.2%)');
    expect(r.text).not.toMatch(/NaN|Infinity/);
    expectNoGenericSummary(r.text, 'row 10');
  });
  it('11. COMPARE THIS WEEK TO LAST WEEK SALES → both periods, correctly signed decline', () => {
    const r = live('COMPARE THIS WEEK TO LAST WEEK SALES');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('this week: $120.00 · last week: $185.00');
    expect(r.text).toContain('Difference: -$65.00 (-35.1%)');
    expect(r.text).not.toMatch(/NaN|Infinity/);
    expectNoGenericSummary(r.text, 'row 11');
  });
  it('10b/11b. reversed utterances answer with the SAME business direction (R1.4)', () => {
    expect(live('COMPARE THIS MONTH TO LAST MONTH SALES').text).toContain('Difference: +$170.00 (+87.2%)');
    expect(live('COMPARE LAST WEEK TO THIS WEEK SALES').text).toContain('Difference: -$65.00 (-35.1%)');
  });
  it('12. SALES BY CARRIER LAST MONTH → carrier-grouped, dimension retained', () => {
    const r = live('SALES BY CARRIER LAST MONTH');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('(last month)');
    expect(r.text).toContain('AT&T — $65.00');
    expectNoGenericSummary(r.text, 'row 12');
  });
  it('13. TOP 5 CUSTOMERS THIS MONTH → honest terminal (lifetime-only ranking), never name-lookup error', () => {
    const r = live('TOP 5 CUSTOMERS THIS MONTH');
    expect(r.intent).toBe('data_query');
    expect(r.text).toBe("I can rank customers by exact lifetime value, but not for a specific period — I won't estimate it.");
    expect(r.text).not.toContain("couldn't find a customer");
    expectNoGenericSummary(r.text, 'row 13');
  });
  it('14. BEST SELLING PRODUCT LAST WEEK → PRODUCTS only, not payment/service lines (R1.4)', () => {
    const r = live('BEST SELLING PRODUCT LAST WEEK');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('(last week)');
    expect(r.text).toContain('1. Charger — $120.00');
    expect(r.text).not.toContain('AT&T - 8054445555');      // phone payment is NOT a product
    expect(r.text).not.toContain('Gross sales: $185.00');   // must NOT collapse to the period total
    expectNoGenericSummary(r.text, 'row 14');
  });
  it('15. HOW MUCH PROFIT DID I MAKE LAST MONTH → canonical PROFIT incl. carrier commission', () => {
    const r = live('HOW MUCH PROFIT DID I MAKE LAST MONTH');
    expect(r.intent).toBe('data_query');
    // 2500 + 5500 item profit + 650 (AT&T 10% commission on $65.00) = $86.50
    expect(r.text).toContain('Profit: $86.50 (last month)');
    expect(r.text).not.toMatch(/^Gross sales|Revenue:/);
    expectNoGenericSummary(r.text, 'row 15');
  });
  it('16. WHAT SHOULD I FOCUS ON TODAY → Manager-owned (brief with score)', () => {
    const r = live('WHAT SHOULD I FOCUS ON TODAY');
    expect(r.intent).toBe('data_query');                  // manager runs FIRST inside data_query
    expect(r.text).toContain('Business brief');
    expect(r.text).toContain('Performance score');
    expect(r.text).not.toContain('Focus today');          // legacy operator focus must not answer
  });
  it('17. BUSINESS BRIEF → Manager brief with score + confidence', () => {
    const r = live('BUSINESS BRIEF');
    // No keyword bank scores it → zero-score fallback_question, whose handler
    // runs the I4 manager FIRST. Semantic owner: Business Manager.
    expect(r.intent).toBe('fallback_question');
    expect(r.text).toContain('Business brief');
    expect(r.text).toMatch(/Performance score: \d+\/100/);
    expect(r.text).toMatch(/Evidence confidence: \d+%/);
  });
  it('18. PROFIT THIS MONTH → canonical structured profit', () => {
    const r = live('PROFIT THIS MONTH');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Profit: $165.70 (this month)');
    expectNoGenericSummary(r.text, 'row 18');
  });
  it('19. SALES → approved generic last-30-days summary (preserved)', () => {
    const r = live('SALES');
    expect(r.intent).toBe('sales_summary');
    expect(r.text).toContain('Last 30 days revenue');
  });
  it('20. HOW IS MY BUSINESS DOING → Manager health sections', () => {
    const r = live('HOW IS MY BUSINESS DOING');
    expect(r.intent).toBe('data_query');
    expect(r.text).toContain('Business health');
    expect(r.text).not.toContain('Store health: A');      // legacy grade must not answer
  });
  it('non-exact manager-adjacent phrasings KEEP their legacy routing', () => {
    expect(classifyIntent('what to do today', CUSTOMERS, 'en').id).not.toBe('data_query');
    expect(classifyIntent('health check', CUSTOMERS, 'en').id).not.toBe('data_query');
  });
  it('bare "top customers" (no explicit period) is NOT affected by the period guard', () => {
    // Live route: with customers present, 'top customers' keeps its locked
    // best_customer ownership (earlier bank position). The R1.3 executor
    // guard is period-gated only — assert the STRUCTURED ranking path still
    // ranks when no explicit period was asked (regression for the guard).
    const r = live('top customers');
    expect(r.intent).toBe('best_customer');
    expect(r.text).toContain('JENNY MIRANDA');
    expect(r.text).not.toContain('I can rank customers by exact lifetime value, but not');
  });
});
