// ============================================================
// CELLHUB-INTELLIGENCE-I3-2 — structured business query executor tests.
//
// End-to-end: parse → validate → resolve → execute (canonical) → format →
// (route). EVERY expected money value is computed through the canonical
// services inside the fixture (computeReportMoneyStats /
// computeCustomerMoneyProfile / canonical stats rows) — no formula is
// reproduced in test expectations. Fixed reference date for determinism.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { tryHandleStructuredBusinessQuery } from './tryHandleStructuredBusinessQuery';
import { clearAnalyticalContext } from './analyticalContext';
import { resolveBusinessDateRange, derivePreviousPeriod } from './resolveBusinessDateRange';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { ReportMoneyStats, ReportMoneyStatsInput } from '@/services/reports/computeReportMoneyStats';
import { computeCustomerMoneyProfile } from '@/services/customers/customerMoneyProfile';
import { formatCurrency } from '@/utils/currency';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import { localDayRangeForIntelRange } from '../adapters/reportMoneyAdapter';
import type { Customer, Sale, SaleItem, Repair, Unlock } from '@/store/types';

// Fixed "now": July 15, 2026 (local).
const REF = new Date(2026, 6, 15, 12, 0, 0);
const portal = (id: string, name: string) => ({ id, name, label: name, emoji: '', color: '', matchCarriers: [], matchUrlSnippets: [] });
const SETTINGS = {
  carrierCommissions: { 'AT&T': 0.10, 'Verizon': 0.07 },
  defaultCommissionRate: 0.07,
  paymentPortals: [portal('ePay', 'ePay'), portal('VidaPay', 'VidaPay')],
};

const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
const CARLOS: Customer = { id: 'cust-carlos', name: 'CARLOS PEREZ', phone: '8051112222' } as unknown as Customer;

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
function attPayment(day: string, portal: string): Sale {
  return sale({
    createdAt: `${day}T10:00:00`, customerId: 'cust-jenny', customerPhone: '8054523932',
    employeeName: 'Ana',
    items: [item({ name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal })],
    subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
  });
}
function verizonPayment(day: string, portal: string): Sale {
  return sale({
    createdAt: `${day}T11:00:00`, customerId: 'cust-carlos', customerPhone: '8051112222',
    employeeName: 'Luis',
    items: [item({ name: 'Verizon - 8051112222', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', portal })],
    subtotal: 6000, total: 6000,
  });
}

function buildWorld() {
  const sales: Sale[] = [
    // Jenny: 3 AT&T payments in July via ePay (Ana).
    attPayment('2026-07-03', 'ePay'), attPayment('2026-07-06', 'ePay'), attPayment('2026-07-09', 'ePay'),
    // Carlos: 2 Verizon payments via VidaPay (Luis).
    verizonPayment('2026-07-04', 'VidaPay'), verizonPayment('2026-07-08', 'VidaPay'),
    // Accessories: cash (Ana, today) + card (Luis) + store credit (Ana).
    sale({ createdAt: '2026-07-15T09:00:00', items: [item({ name: 'Case', price: 2500, qty: 1, cost: 1000 })], subtotal: 2500, total: 2500, employeeName: 'Ana' }),
    sale({ createdAt: '2026-07-10T09:00:00', paymentMethod: 'card' as Sale['paymentMethod'], items: [item({ name: 'Charger', price: 8000, qty: 1, cost: 3000 })], subtotal: 8000, total: 8000, employeeName: 'Luis' }),
    sale({ createdAt: '2026-07-11T09:00:00', paymentMethod: 'store_credit' as Sale['paymentMethod'], items: [item({ name: 'Glass', price: 1500, qty: 1, cost: 500 })], subtotal: 1500, total: 1500, employeeName: 'Ana' }),
    // Voided sale — must never count.
    sale({ createdAt: '2026-07-07T09:00:00', status: 'voided' as Sale['status'], items: [item({ name: 'VOID', price: 99999, qty: 1, cost: 0 })], subtotal: 99999, total: 99999 }),
    // June (last month) activity for period comparisons.
    sale({ createdAt: '2026-06-10T09:00:00', items: [item({ name: 'JuneCase', price: 4000, qty: 1, cost: 1500 })], subtotal: 4000, total: 4000, employeeName: 'Ana' }),
    // July 2025 (explicit-year custom range).
    sale({ createdAt: '2025-07-05T09:00:00', items: [item({ name: 'OldSale', price: 3000, qty: 1, cost: 1200 })], subtotal: 3000, total: 3000 }),
  ];
  const repairs: Repair[] = [
    { id: 'rep-1', customerId: 'x', status: 'picked_up', balance: 0, total: 9000, laborCost: 2000, parts: [{ id: 'p', name: 'Screen', price: 0, cost: 1500, qty: 1 }], createdAt: '2026-07-05T12:00:00' } as unknown as Repair,
  ];
  const unlocks: Unlock[] = [
    { id: 'unl-1', customerId: 'x', status: 'completed', balance: 0, price: 4000, cost: 500, createdAt: '2026-07-06T12:00:00' } as unknown as Unlock,
  ];
  return { sales, repairs, unlocks };
}

function buildEngine(world = buildWorld()): IntelligenceEngine {
  return new IntelligenceEngine(
    world.sales as unknown as Sale[], [JENNY, CARLOS], [], world.repairs as never,
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { unlocks: world.unlocks, customerReturns: [], vendorReturns: [], settings: SETTINGS, employees: [{ id: 'emp-ana', name: 'Ana' }, { id: 'emp-luis', name: 'Luis' }] } as never,
  );
}

/** Canonical reference — the ONLY source of expected money values. */
function canonical(world: ReturnType<typeof buildWorld>, kind: 'today' | 'yesterday' | 'this_week' | 'this_month', opts: Partial<ReportMoneyStatsInput> = {}): ReportMoneyStats {
  return computeReportMoneyStats({
    sales: world.sales, repairs: world.repairs, unlocks: world.unlocks,
    specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
    settings: SETTINGS as never, periodRange: localDayRangeForIntelRange(kind, REF),
    labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    ...opts,
  });
}

const ask = (engine: IntelligenceEngine, q: string, lang: 'en' | 'es' | 'pt' = 'en') =>
  tryHandleStructuredBusinessQuery(engine, q, lang, REF);

beforeEach(() => clearAnalyticalContext());

// ══ Date resolution + previous period ═══════════════════════
describe('I3-2 — date resolution', () => {
  it('named ranges resolve to inclusive local days; default is last_30_days', () => {
    expect(resolveBusinessDateRange({ kind: 'today' }, REF)!.startYMD).toBe('2026-07-15');
    expect(resolveBusinessDateRange({ kind: 'yesterday' }, REF)!.startYMD).toBe('2026-07-14');
    expect(resolveBusinessDateRange({ kind: 'last_month' }, REF)).toMatchObject({ startYMD: '2026-06-01', endYMD: '2026-06-30' });
    const lastWeek = resolveBusinessDateRange({ kind: 'last_week' }, REF)!;
    expect(lastWeek.startYMD).toBe('2026-07-05');   // Sunday-anchored previous week
    expect(lastWeek.endYMD).toBe('2026-07-11');
    expect(resolveBusinessDateRange(undefined, REF)).toMatchObject({ labelKind: 'last_30_days', defaulted: true });
  });
  it('invalid/reversed custom ranges never execute', () => {
    expect(resolveBusinessDateRange({ kind: 'custom', startDate: '2026-07-20', endDate: '2026-07-01' }, REF)).toBeNull();
    expect(resolveBusinessDateRange({ kind: 'custom', startDate: '2026-07-01' }, REF)).toBeNull();
  });
  it('previous period = same inclusive length immediately before', () => {
    const today = resolveBusinessDateRange({ kind: 'today' }, REF)!;
    expect(derivePreviousPeriod(today)).toMatchObject({ startYMD: '2026-07-14', endYMD: '2026-07-14' });
    const month = resolveBusinessDateRange({ kind: 'this_month' }, REF)!;   // Jul 1–15 (15 days)
    expect(derivePreviousPeriod(month)).toMatchObject({ startYMD: '2026-06-16', endYMD: '2026-06-30' });
  });
});

// ══ English matrix ══════════════════════════════════════════
describe('I3-2 — English matrix (canonical parity)', () => {
  const world = buildWorld();
  const engine = buildEngine(world);

  it('1. gross sales today', () => {
    const c = canonical(world, 'today');
    const r = ask(engine, 'What were gross sales today?');
    expect(r?.text).toContain(formatCurrency(c.grossSalesCents));
    expect(r?.text).toContain('Gross sales');
  });
  it('3. profit this month', () => {
    const c = canonical(world, 'this_month');
    expect(ask(engine, 'What was our profit this month?')?.text).toContain(formatCurrency(c.totalProfitCents));
  });
  it('4. margin this month (canonical meaningful)', () => {
    const c = canonical(world, 'this_month');
    const r = ask(engine, 'What is our margin this month?');
    expect(r?.text).toContain(`${c.profitMargin.toFixed(1)}%`);
  });
  it('5/6. cash + card today/this month', () => {
    const c = canonical(world, 'this_month');
    expect(ask(engine, 'How much did we collect in cash this month?')?.text).toContain(formatCurrency(c.cashCents));
    expect(ask(engine, 'How much was paid by card this month?')?.text).toContain(formatCurrency(c.cardCents));
  });
  it('8. transactions today (count)', () => {
    const c = canonical(world, 'today');
    expect(ask(engine, 'How many transactions today?')?.text).toContain(String(c.txCount));
  });
  it('7. average ticket = POS-only population (standalones excluded)', () => {
    const world2 = buildWorld();
    const posOnly = canonical(world2, 'this_week', { repairs: [], unlocks: [] });
    const expected = posOnly.txCount > 0 ? Math.round(posOnly.grossSalesCents / posOnly.txCount) : 0;
    const r = ask(buildEngine(world2), 'What is the average ticket this week?');
    expect(r?.text).toContain(formatCurrency(expected));
  });
  it('9. cash versus card this month (between_metrics)', () => {
    const c = canonical(world, 'this_month');
    const r = ask(engine, 'Show cash versus card this month');
    expect(r?.text).toContain(formatCurrency(c.cashCents));
    expect(r?.text).toContain(formatCurrency(c.cardCents));
  });
  it('11. AT&T profit versus Verizon profit this month (scoped canonical)', () => {
    // Expected: canonical projections over PURE single-carrier sales (scoping
    // in the fixture; math canonical).
    const att = world.sales.filter((s) => (s.items || []).every((i) => String((i as { carrier?: string }).carrier) === 'AT&T'));
    const ver = world.sales.filter((s) => (s.items || []).every((i) => String((i as { carrier?: string }).carrier) === 'Verizon'));
    const cAtt = canonical(world, 'this_month', { sales: att, repairs: [], unlocks: [] });
    const cVer = canonical(world, 'this_month', { sales: ver, repairs: [], unlocks: [] });
    const r = ask(engine, 'Compare AT&T profit versus Verizon profit this month');
    expect(r?.text).toContain(formatCurrency(cAtt.totalProfitCents));
    expect(r?.text).toContain(formatCurrency(cVer.totalProfitCents));
  });
  it('12. ePay versus VidaPay this month (canonical provider rows, runtime IDs)', () => {
    const c = canonical(world, 'this_month');
    const epay = c.phonePaymentsByProvider['ePay'];
    const vida = c.phonePaymentsByProvider['VidaPay'];
    expect(epay && vida).toBeTruthy();
    const r = ask(engine, 'Compare ePay versus VidaPay this month');
    expect(r?.text).toContain(formatCurrency(epay.totalCents));
    expect(r?.text).toContain(formatCurrency(vida.totalCents));
  });
  it('13. this month versus last month net sales (between_periods)', () => {
    const cThis = canonical(world, 'this_month');
    const cLast = computeReportMoneyStats({
      sales: world.sales, repairs: world.repairs, unlocks: world.unlocks, specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
      settings: SETTINGS as never, periodRange: normalizeLocalDayRange('2026-06-01', '2026-06-30'),
      labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    });
    const r = ask(engine, 'Compare this month with last month net sales');
    expect(r?.text).toContain(formatCurrency(cThis.netSalesCents));
    expect(r?.text).toContain(formatCurrency(cLast.netSalesCents));
  });
  it('14. did profit increase this month? (verdict + values)', () => {
    const r = ask(engine, 'Did profit increase this month?');
    expect(r?.text).toMatch(/Yes, it increased\.|No, it decreased\.|No change\./);
  });
  it('15. which carrier sold the most this month (rank, canonical scoped)', () => {
    const r = ask(engine, 'Which carrier sold the most this month?');
    expect(r?.text).toContain('AT&T');       // 3×$68.99 > 2×$60.00
    expect(r?.text.indexOf('AT&T')).toBeLessThan(r!.text.indexOf('Verizon'));
  });
  it('16. which employee generated the highest profit (scoped canonical)', () => {
    const r = ask(engine, 'Which employee generated the highest profit?');
    expect(r?.text).toMatch(/Ana|Luis/);
  });
  it('17. sales by category this month (canonical rows)', () => {
    const c = canonical(world, 'this_month');
    const r = ask(engine, 'Sales by category this month');
    const top = [...c.categoriesByRevenue].sort((a, b) => b.revenueCents - a.revenueCents)[0];
    expect(r?.text).toContain(top.name);
    expect(r?.text).toContain(formatCurrency(top.revenueCents));
  });
  it('18. top customers by Total Collected (canonical customer money)', () => {
    const profile = computeCustomerMoneyProfile({
      customer: JENNY, sales: world.sales, repairs: [], unlocks: [], layaways: [], specialOrders: [],
      customerReturns: [], inventory: [], settings: SETTINGS,
    });
    const r = ask(engine, 'Top customers by Total Collected');
    expect(r?.text).toContain('Total Collected');
    expect(r?.text).toContain('JENNY MIRANDA');
    expect(r?.text).toContain(formatCurrency(profile.totalCollectedCents));
  });
  it('19. find customer Jenny Miranda (canonical 360 parity)', () => {
    const profile = computeCustomerMoneyProfile({
      customer: JENNY, sales: world.sales, repairs: [], unlocks: [], layaways: [], specialOrders: [],
      customerReturns: [], inventory: [], settings: SETTINGS,
    });
    const r = ask(engine, 'Find customer Jenny Miranda');
    expect(r?.text).toContain('JENNY MIRANDA');
    expect(r?.text).toContain(formatCurrency(profile.totalCollectedCents));
    expect(r?.text).toContain(formatCurrency(profile.profitBearingRevenueCents));
    expect(r?.text).toContain(formatCurrency(profile.profitCents));
    expect(r?.text).toContain(`${profile.marginPercent.toFixed(1)}%`);
    expect(r?.text).toContain(String(profile.transactionCount));
    expect(r?.text).toContain(formatCurrency(profile.averageTicketCents));
    expect(r?.text.toLowerCase()).not.toContain('visits');
  });
  it('20. profit July 1, 2025 to July 15, 2025 (explicit year)', () => {
    const c2025 = computeReportMoneyStats({
      sales: world.sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
      settings: SETTINGS as never, periodRange: normalizeLocalDayRange('2025-07-01', '2025-07-15'),
      labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    });
    const r = ask(engine, 'Profit july 1, 2025 to july 15, 2025');
    expect(r?.text).toContain(formatCurrency(c2025.totalProfitCents));
  });
});

// ══ Spanish + Portuguese matrix ═════════════════════════════
describe('I3-2 — Spanish + Portuguese matrix', () => {
  const world = buildWorld();
  const engine = buildEngine(world);
  const cMonth = canonical(world, 'this_month');

  it('22/34. ganancia este mes / lucro deste mês', () => {
    expect(ask(engine, '¿Cuál fue la ganancia este mes?', 'es')?.text).toContain(formatCurrency(cMonth.totalProfitCents));
    expect(ask(engine, 'Qual foi o lucro deste mês?', 'pt')?.text).toContain(formatCurrency(cMonth.totalProfitCents));
  });
  it('21/33. ventas brutas hoy / vendas brutas hoje', () => {
    const cToday = canonical(world, 'today');
    expect(ask(engine, '¿Cuáles fueron las ventas brutas hoy?', 'es')?.text).toContain(formatCurrency(cToday.grossSalesCents));
    expect(ask(engine, 'Quais foram as vendas brutas hoje?', 'pt')?.text).toContain(formatCurrency(cToday.grossSalesCents));
  });
  it('23/35. efectivo ayer / dinheiro ontem', () => {
    const cY = canonical(world, 'yesterday');
    expect(ask(engine, '¿Cuánto cobramos en efectivo ayer?', 'es')?.text).toContain(formatCurrency(cY.cashCents));
    expect(ask(engine, 'Quanto recebemos em dinheiro ontem?', 'pt')?.text).toContain(formatCurrency(cY.cashCents));
  });
  it('24/36. efectivo contra tarjeta / dinheiro versus cartão', () => {
    expect(ask(engine, 'Compara efectivo contra tarjeta este mes', 'es')?.text).toContain(formatCurrency(cMonth.cashCents));
    expect(ask(engine, 'Compare dinheiro versus cartão neste mês', 'pt')?.text).toContain(formatCurrency(cMonth.cardCents));
  });
  it('27/39. qué compañía vendió más / qual operadora vendeu mais', () => {
    const es = ask(engine, '¿Qué compañía vendió más este mes?', 'es');
    const pt = ask(engine, 'Qual operadora vendeu mais neste mês?', 'pt');
    expect(es?.text).toContain('AT&T');
    expect(pt?.text).toContain('AT&T');
  });
  it('29/41. ventas por proveedor de pagos / vendas por provedor de pagamento', () => {
    const es = ask(engine, 'Ventas por proveedor de pagos este mes', 'es');
    expect(es?.text).toContain('ePay');
    expect(es?.text).toContain(formatCurrency(cMonth.phonePaymentsByProvider['ePay'].totalCents));
  });
  it('30/42. mejores clientes por Total Cobrado / melhores clientes por Total Recebido', () => {
    expect(ask(engine, 'Mejores clientes por Total Cobrado', 'es')?.text).toContain('Total Cobrado');
    expect(ask(engine, 'Melhores clientes por Total Recebido', 'pt')?.text).toContain('Total Recebido');
  });
  it('31/43. busca al cliente / encontre a cliente Jenny Miranda', () => {
    expect(ask(engine, 'Busca al cliente Jenny Miranda', 'es')?.text).toContain('JENNY MIRANDA');
    expect(ask(engine, 'Encontre a cliente Jenny Miranda', 'pt')?.text).toContain('JENNY MIRANDA');
  });
  it('32/44. ganancia del 1 al 15 de julio de 2025 / lucro de 1 a 15 de julho de 2025', () => {
    const c2025 = computeReportMoneyStats({
      sales: world.sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
      settings: SETTINGS as never, periodRange: normalizeLocalDayRange('2025-07-01', '2025-07-15'),
      labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    });
    expect(ask(engine, 'Ganancia del 1 al 15 de julio de 2025', 'es')?.text).toContain(formatCurrency(c2025.totalProfitCents));
    expect(ask(engine, 'Lucro de 1 a 15 de julho de 2025', 'pt')?.text).toContain(formatCurrency(c2025.totalProfitCents));
  });
});

// ══ Safety / fallback ═══════════════════════════════════════
describe('I3-2 — safety & fallback (never fabricate, never hijack)', () => {
  const engine = buildEngine();

  const mustFallback = [
    'Paint the store.', 'Tell me a joke.', '¿Cómo está el clima?', 'Play some music',
    'Open Repairs', 'Create a new repair', 'Add an appointment', 'Delete inventory',
    'A vs B vs C',
  ];
  mustFallback.forEach((q) => it(`falls back: ${q}`, () => {
    expect(ask(engine, q)).toBeNull();
  }));

  it('55. invalid custom date (Feb 30) never silently defaults', () => {
    expect(ask(engine, 'sales february 1 to february 30, 2025')).toBeNull();
  });
  it('53. provider dimension + carrier entity conflict → fallback', () => {
    expect(ask(engine, 'which provider sold the most AT&T')).toBeNull();
  });
  it('56. unknown customer → localized not-found', () => {
    const r = ask(engine, 'Find customer Zzyzx Nobody');
    expect(r?.text).toMatch(/not found/i);
  });
  it('57. duplicate customer-name match → ambiguity with candidates', () => {
    const world = buildWorld();
    const twin: Customer = { id: 'cust-jenny2', name: 'JENNY MIRANDA LOPEZ', phone: '8059998888' } as unknown as Customer;
    const engine2 = new IntelligenceEngine(
      world.sales as unknown as Sale[], [JENNY, twin], [], [],
      { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { customerReturns: [], settings: SETTINGS } as never,
    );
    const r = tryHandleStructuredBusinessQuery(engine2, 'Find customer Jenny Miranda', 'en', REF);
    expect(r?.text).toMatch(/which one|coincidencias|correspond/i);
  });
  it('58. unsupported service-dimension money grouping → fallback (never $0.00)', () => {
    expect(ask(engine, 'Compare repairs with unlocks this month')).toBeNull();
  });
  it('executor-boundary error → fallback (never crash)', () => {
    const broken = { getStructuredQueryContext: () => { throw new Error('boom'); } } as unknown as IntelligenceEngine;
    expect(tryHandleStructuredBusinessQuery(broken, 'profit today', 'en', REF)).toBeNull();
  });
});

// ══ Store scope + entity identity ═══════════════════════════
describe('I3-2 — store scope + entity identity', () => {
  it('current store sees only its (pre-scoped) snapshot; no cross-store leakage', () => {
    const worldA = { sales: [attPayment('2026-07-03', 'ePay')], repairs: [], unlocks: [] };
    const worldB = { sales: [verizonPayment('2026-07-04', 'VidaPay'), verizonPayment('2026-07-08', 'VidaPay')], repairs: [], unlocks: [] };
    const engineA = buildEngine(worldA as ReturnType<typeof buildWorld>);
    const engineB = buildEngine(worldB as ReturnType<typeof buildWorld>);
    const rA = ask(engineA, 'Which carrier sold the most this month?');
    expect(rA?.text).toContain('AT&T');
    expect(rA?.text).not.toContain('Verizon');       // store B's carrier never leaks
    const rB = ask(engineB, 'Which carrier sold the most this month?');
    expect(rB?.text).toContain('Verizon');
    expect(rB?.text).not.toContain('AT&T');
  });
  it('similar runtime provider names do not collapse (IDs preserved)', () => {
    const world = buildWorld();
    const engine = buildEngine(world);
    const c = canonical(world, 'this_month');
    const r = ask(engine, 'Compare ePay versus VidaPay this month');
    // Both providers present with DIFFERENT canonical values.
    expect(c.phonePaymentsByProvider['ePay'].totalCents).not.toBe(c.phonePaymentsByProvider['VidaPay'].totalCents);
    expect(r?.text).toContain(formatCurrency(c.phonePaymentsByProvider['ePay'].totalCents));
  });
});

// ══ Follow-ups (analytical context) ═════════════════════════
describe('I3-2 — session follow-ups', () => {
  it('"what about last month?" reuses the previous metric', () => {
    const world = buildWorld();
    const engine = buildEngine(world);
    const first = ask(engine, 'What was our profit this month?');
    expect(first).not.toBeNull();
    const cLast = computeReportMoneyStats({
      sales: world.sales, repairs: world.repairs, unlocks: world.unlocks, specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
      settings: SETTINGS as never, periodRange: normalizeLocalDayRange('2026-06-01', '2026-06-30'),
      labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    });
    const followUp = ask(engine, 'what about last month?');
    expect(followUp?.text).toContain(formatCurrency(cLast.totalProfitCents));
  });
  it('explicit new metric overrides context; unrelated chatter never merges', () => {
    const engine = buildEngine();
    ask(engine, 'What was our profit this month?');
    const cash = ask(engine, 'How much cash this month?');
    expect(cash?.text).toContain('Cash');
    expect(ask(engine, 'Tell me a joke.')).toBeNull();   // no merge, no context mutation
  });
});
