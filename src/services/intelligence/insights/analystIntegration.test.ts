// ============================================================
// I3-3 Business Analyst — live-gate integration tests.
//
// Proves the user-visible behavior: enriched answers (trend + exact
// contributors, EN/ES/PT), "What changed?" and entity follow-ups, and that
// nothing is fabricated when data is unavailable. Fixed reference date.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { tryHandleStructuredBusinessQuery } from '../query/tryHandleStructuredBusinessQuery';
import { clearAnalyticalContext } from '../query/analyticalContext';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import { formatCurrency } from '@/utils/currency';
import type { Customer, Sale, SaleItem } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);
const portal = (id: string, name: string) => ({ id, name, label: name, emoji: '', color: '', matchCarriers: [], matchUrlSnippets: [] });
const SETTINGS = {
  carrierCommissions: { 'AT&T': 0.10, 'Verizon': 0.07 },
  defaultCommissionRate: 0.07,
  paymentPortals: [portal('ePay', 'ePay'), portal('VidaPay', 'VidaPay')],
};
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;

let seq = 0;
function item(over: Partial<SaleItem> & { portal?: string }): SaleItem {
  return { id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...over } as SaleItem;
}
function sale(over: Partial<Sale>): Sale {
  const total = over.total ?? 0;
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [], subtotal: over.subtotal ?? total,
    taxAmount: 0, cbeTotal: 0, total, paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'], createdAt: '2026-07-05T10:00:00', employeeName: 'Ana', ...over,
  } as Sale;
}
const att = (day: string) => sale({
  createdAt: `${day}T10:00:00`, customerId: 'cust-jenny', customerPhone: '8054523932',
  items: [item({ name: 'AT&T - X', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal: 'ePay' })],
  subtotal: 6500, total: 6500,
});
const verizon = (day: string) => sale({
  createdAt: `${day}T11:00:00`,
  items: [item({ name: 'Verizon - Y', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', portal: 'VidaPay' })],
  subtotal: 6000, total: 6000,
});

function buildWorld() {
  return {
    // July: AT&T strong + small accessory. June 16-30: big accessories.
    sales: [
      att('2026-07-03'), att('2026-07-06'), att('2026-07-09'),
      verizon('2026-07-04'),
      sale({ createdAt: '2026-07-05T09:00:00', items: [item({ name: 'Case', price: 2000, qty: 1, cost: 800 })], subtotal: 2000, total: 2000 }),
      sale({ createdAt: '2026-06-18T09:00:00', items: [item({ name: 'BigCase', price: 9000, qty: 1, cost: 4000 })], subtotal: 9000, total: 9000 }),
      sale({ createdAt: '2026-06-22T09:00:00', items: [item({ name: 'BigCase2', price: 7000, qty: 1, cost: 3000 })], subtotal: 7000, total: 7000 }),
    ],
    repairs: [], unlocks: [],
  };
}

function buildEngine(world = buildWorld()): IntelligenceEngine {
  return new IntelligenceEngine(
    world.sales as unknown as Sale[], [JENNY], [], world.repairs as never,
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { unlocks: world.unlocks, customerReturns: [], vendorReturns: [], settings: SETTINGS, employees: [] } as never,
  );
}

const ask = (engine: IntelligenceEngine, q: string, lang: 'en' | 'es' | 'pt' = 'en') =>
  tryHandleStructuredBusinessQuery(engine, q, lang, REF);

function canonicalMonth(world: ReturnType<typeof buildWorld>, startYMD: string, endYMD: string) {
  return computeReportMoneyStats({
    sales: world.sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
    settings: SETTINGS as never, periodRange: normalizeLocalDayRange(startYMD, endYMD),
    labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
  });
}

beforeEach(() => clearAnalyticalContext());

describe('I3-3 — enriched answers (explanation layer)', () => {
  it('EN: profit answer includes trend arrow + biggest increase + largest decline', () => {
    const world = buildWorld();
    const r = ask(buildEngine(world), 'What was our profit this month?');
    expect(r?.text).toMatch(/Profit.*this month/);
    expect(r?.text).toMatch(/[▲▼=]/);
    expect(r?.text).toMatch(/Biggest increase: /);
    expect(r?.text).toMatch(/Largest decline: /);
    // Trend direction matches canonical numbers.
    const cur = canonicalMonth(world, '2026-07-01', '2026-07-15').totalProfitCents;
    const prev = canonicalMonth(world, '2026-06-16', '2026-06-30').totalProfitCents;
    expect(r?.text).toContain(cur > prev ? '▲' : cur < prev ? '▼' : '=');
    expect(r?.text).toContain(`(${formatCurrency(prev)})`);   // previous value shown
  });
  it('ES/PT: localized explanation wording', () => {
    const es = ask(buildEngine(), '¿Cuál fue la ganancia este mes?', 'es');
    expect(es?.text).toMatch(/Subió|Bajó|Sin cambio/);
    expect(es?.text).toMatch(/Mayor aumento|Mayor caída/);
    const pt = ask(buildEngine(), 'Qual foi o lucro deste mês?', 'pt');
    expect(pt?.text).toMatch(/Subiu|Caiu|Sem mudança/);
  });
  it('no fabricated explanations: cash (no exact grouping) gets trend only, no contributors', () => {
    const r = ask(buildEngine(), 'How much cash this month?');
    expect(r?.text).toMatch(/Cash/);
    expect(r?.text).not.toMatch(/Biggest increase/);
    expect(r?.text).not.toMatch(/Largest decline/);
  });
  it('entity-scoped answers stay focused (no whole-store explanation appended)', () => {
    const r = ask(buildEngine(), 'AT&T sales this month');
    expect(r?.text).toContain('AT&T');
    expect(r?.text).not.toMatch(/Biggest increase/);
  });
  it('comparisons keep their own format (no double explanation)', () => {
    const r = ask(buildEngine(), 'Show cash versus card this month');
    expect(r?.text).not.toMatch(/Biggest increase/);
  });
});

describe('I3-3 — follow-up memory (Part 13)', () => {
  it('"What changed?" re-runs the last metric vs previous period', () => {
    const world = buildWorld();
    const engine = buildEngine(world);
    ask(engine, 'What was our profit this month?');
    const r = ask(engine, 'What changed?');
    const cur = canonicalMonth(world, '2026-07-01', '2026-07-15').totalProfitCents;
    const prev = canonicalMonth(world, '2026-06-16', '2026-06-30').totalProfitCents;
    expect(r?.text).toContain(formatCurrency(cur));
    expect(r?.text).toContain(formatCurrency(prev));
  });
  it('"¿Qué cambió?" and "O que mudou?" work localized', () => {
    const engine = buildEngine();
    ask(engine, '¿Cuál fue la ganancia este mes?', 'es');
    expect(ask(engine, '¿Qué cambió?', 'es')?.text).toMatch(/Diferencia/);
    ask(engine, 'Qual foi o lucro deste mês?', 'pt');
    expect(ask(engine, 'O que mudou?', 'pt')?.text).toMatch(/Diferença/);
  });
  it('"What about Verizon?" reuses the last metric with the new entity', () => {
    const world = buildWorld();
    const engine = buildEngine(world);
    ask(engine, 'AT&T sales this month');
    const r = ask(engine, 'What about Verizon?');
    // Canonical Verizon-only gross for July 1-15.
    const verizonOnly = computeReportMoneyStats({
      sales: world.sales.filter((s) => (s.items || []).every((i) => String((i as { carrier?: string }).carrier) === 'Verizon')),
      repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
      settings: SETTINGS as never, periodRange: normalizeLocalDayRange('2026-07-01', '2026-07-15'),
      labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    });
    expect(r?.text).toContain('Verizon');
    expect(r?.text).toContain(formatCurrency(verizonOnly.grossSalesCents));
  });
  it('"What changed?" without prior context stays on legacy fallback', () => {
    expect(ask(buildEngine(), 'What changed?')).toBeNull();
  });
});
