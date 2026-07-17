// ============================================================
// CELLHUB-INTELLIGENCE-I2B-2 / I2B-2.1 — analyzer ⇄ canonical money parity.
//
// The Financial / Sales / Customer analyzer AUTHORITATIVE money answers come
// from the canonical services (computeReportMoneyStats / customerMoneyProfile)
// via the injected canonical range provider — never a manual reduce. Every
// expected value is computed through the canonical service and compared
// field-by-field. JENNY MIRANDA is the deterministic customer case.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { CustomerAnalyzer } from './CustomerAnalyzer';
import { SalesAnalyzer } from './SalesAnalyzer';
import { FinancialAnalyzer } from './FinancialAnalyzer';
import { computeCustomerMoneyProfile } from '@/services/customers/customerMoneyProfile';
import {
  computeCanonicalMoneyForRange, localDayRangeForWindow,
} from '../adapters/reportMoneyAdapter';
import type { CanonicalWindowProvider } from '../adapters/reportMoneyAdapter';
import type { Customer, Sale, SaleItem, CustomerReturn } from '@/store/types';

const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
const SETTINGS = { carrierCommissions: { 'AT&T': 0.10 }, defaultCommissionRate: 0.07 };

let seq = 0;
function mkItem(over: Partial<SaleItem>): SaleItem {
  return { id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...over } as SaleItem;
}
function mkSale(over: Partial<Sale>): Sale {
  const total = over.total ?? 0;
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [], subtotal: over.subtotal ?? total,
    taxAmount: 0, cbeTotal: 0, total, customerId: 'cust-jenny', customerPhone: '8054523932',
    paymentMethod: 'cash' as Sale['paymentMethod'], status: 'completed' as Sale['status'],
    createdAt: '2026-06-10T12:00:00', ...over,
  } as Sale;
}
function jennyPayment(month: number, over: Partial<SaleItem> = {}): Sale {
  return mkSale({
    createdAt: `2026-${String(month).padStart(2, '0')}-05T10:00:00`,
    items: [mkItem({ name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', ...over })],
    subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
  });
}
const jennySales = () => [1, 2, 3, 4, 5, 6, 7].map((m) => jennyPayment(m));

function buildEngine(sales: Sale[], extras: Record<string, unknown> = {}): IntelligenceEngine {
  return new IntelligenceEngine(
    sales as unknown as Sale[], (extras.customers as Customer[]) ?? [JENNY], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: (extras.customerReturns as CustomerReturn[]) ?? [], settings: SETTINGS, ...extras } as never,
  );
}
function canonicalJenny(sales: Sale[], returns: CustomerReturn[] = []) {
  return computeCustomerMoneyProfile({
    customer: JENNY, sales, repairs: [], unlocks: [], layaways: [], specialOrders: [],
    customerReturns: returns, inventory: [], settings: SETTINGS,
  });
}

// A canonical range provider over a fixed snapshot — the SAME projection the
// engine injects into the analyzers. Used for direct-analyzer construction.
function providerFor(sales: Sale[], returns: CustomerReturn[] = []): CanonicalWindowProvider {
  const snapshot = {
    sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [],
    customerReturns: returns, vendorReturns: [], settings: SETTINGS,
  };
  return (window) => computeCanonicalMoneyForRange(snapshot, localDayRangeForWindow(window));
}

// ══ CUSTOMER (unchanged canonical behavior from 15a1db3) ══

describe('I2B-2 Customer — Jenny deterministic case (test 24)', () => {
  const sales = jennySales();
  const engine = buildEngine(sales);

  it('engine.getCustomerValueProfiles === customerMoneyProfile', () => {
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    const c = canonicalJenny(sales);
    expect(p.totalCollectedCents).toBe(c.totalCollectedCents);
    expect(p.profitCents).toBe(c.profitCents);
    expect(p.marginPercent).toBe(c.marginPercent);
    expect(p.transactionCount).toBe(c.transactionCount);
    expect(p.averageTicketCents).toBe(c.averageTicketCents);
  });

  it('$482.93 / $455.00 / $45.50 / 10.0% / 7 tx / $68.99 (test 24: unchanged)', () => {
    const top = engine.getTopCustomersByValue(5);
    expect(top[0].customerId).toBe('cust-jenny');
    expect(top[0].revenueCents).toBe(48293);
    expect(top[0].profitCents).toBe(4550);
    expect(top[0].marginPercent).toBe(10);
    expect(top[0].transactionCount).toBe(7);
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    expect(p.profitBearingRevenueCents).toBe(45500);
    expect(p.averageTicketCents).toBe(6899);
    expect(p.exactCoveragePercent).toBe(100);      // configured commission is exact
    expect(p.profitEstimated).toBe(false);
  });
});

describe('I2B-2.1 Customer — fallback removal + scope (tests 20/23)', () => {
  it('20. a monetary method WITHOUT a canonical provider throws (no silent sum(sale.total))', () => {
    const ca = new CustomerAnalyzer([JENNY], jennySales(), undefined, 'en'); // no provider
    expect(() => ca.getCustomerLifetimeValue()).toThrow(/canonical money provider/);
    expect(() => ca.getTopCustomers('spend')).toThrow(/canonical money provider/);
    expect(() => ca.getMetrics()).toThrow(/canonical money provider/);
    // Non-monetary methods still work without a provider.
    expect(() => ca.getVIPs()).not.toThrow();
    expect(() => ca.getAtRiskCustomers()).not.toThrow();
  });

  it('with a provider, CustomerAnalyzer money == canonical', () => {
    const sales = jennySales();
    const engine = buildEngine(sales);
    const ca = new CustomerAnalyzer([JENNY], sales, undefined, 'en', () => engine.getCustomerValueProfiles());
    expect(ca.getCustomerLifetimeValue()['cust-jenny']).toBe(48293);
    expect(ca.getTopCustomers('spend')[0].id).toBe('cust-jenny');
    expect(ca.getMetrics().avgLTV).toBe(48293);
  });

  it('23. customer store-scope: only the scoped snapshot is consulted', () => {
    const a: Customer = { id: 'cust-a', name: 'A', phone: '8051110000' } as unknown as Customer;
    const b: Customer = { id: 'cust-b', name: 'B', phone: '8052220000' } as unknown as Customer;
    const sales = [
      mkSale({ id: 'sa', customerId: 'cust-a', customerPhone: '8051110000', items: [mkItem({ name: 'X', price: 5000, cost: 2000 })], subtotal: 5000, total: 5000 }),
      mkSale({ id: 'sb', customerId: 'cust-b', customerPhone: '8052220000', items: [mkItem({ name: 'Y', price: 5000, cost: 2000 })], subtotal: 5000, total: 5000 }),
    ];
    const engine = buildEngine(sales, { customers: [b, a] });
    const top = engine.getTopCustomersByValue(5);
    expect(top.map((t) => t.customerId)).toEqual(['cust-a', 'cust-b']); // deterministic id tie-break
    expect(top[0].revenueCents).toBe(5000);
  });
});

// ══ SALES ANALYZER (authoritative money = canonical) ══

const now = () => new Date().toISOString();
function aSale(over: Partial<Sale>): Sale {
  return {
    id: `as-${++seq}`, invoiceNumber: `INV-${seq}`, status: 'completed', paymentMethod: 'cash',
    total: 10000, subtotal: 10000, createdAt: now(), customerId: undefined,
    items: [mkItem({ name: 'Glass', price: 10000, qty: 1, cost: 6000 })], ...over,
  } as Sale;
}
const wideWindow = () => ({ start: new Date(Date.now() - 7 * 86_400_000), end: new Date(Date.now() + 86_400_000), label: '7d' });

describe('I2B-2.1 Sales analyzer — authoritative money from canonical', () => {
  it('totalRevenue = canonical gross, netRevenueCents = canonical net, tx = canonical (tests 14/15)', () => {
    const sales = [aSale({ id: 'ok', total: 10000 }), aSale({ id: 'void', total: 99999, status: 'voided' as Sale['status'] })];
    const sa = new SalesAnalyzer(sales, [], undefined, 'en', providerFor(sales));
    const w = wideWindow();
    const c = computeCanonicalMoneyForRange({ sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [], settings: SETTINGS }, localDayRangeForWindow(w));
    const m = sa.getMetrics(w);
    expect(m.totalRevenue).toBe(c.grossSalesCents);
    expect(m.totalRevenue).toBe(10000);            // voided $999.99 excluded canonically
    expect(m.transactionCount).toBe(c.txCount);
    expect(m.transactionCount).toBe(1);
    expect(m.netRevenueCents).toBe(c.netSalesCents);
    expect(m.avgTransactionSize).toBe(10000);
  });

  it('15. refund-audit row excluded (canonical grossActivity)', () => {
    const sales = [aSale({ id: 'ok', total: 10000 }), aSale({ id: 'REFUND-1', invoiceNumber: 'REFUND-INV-1', total: -4000 })];
    const sa = new SalesAnalyzer(sales, [], undefined, 'en', providerFor(sales));
    expect(sa.getMetrics(wideWindow()).totalRevenue).toBe(10000);
  });

  it('16. REAL negative canonical net-sales is returned unclamped', () => {
    // Original out of the window (5 days ago), full refund inside → net negative.
    const orig = aSale({ id: 'o', createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), total: 8000, subtotal: 8000 });
    const ret: CustomerReturn = {
      id: 'r', returnNumber: 'RTN-1', originalInvoice: orig.invoiceNumber, originalSaleId: orig.id,
      customerName: 'X', customerPhone: '', employeeName: 'op', createdAt: now(), reason: 'defective', resolution: 'cash', notes: '',
      items: [{ id: orig.items[0].id, name: 'Glass', qty: 1, priceCents: 8000, subtotalCents: 8000, taxCents: 0, totalCents: 8000 }] as CustomerReturn['items'],
      subtotalCents: 8000, taxCents: 0, totalCents: 8000,
    } as unknown as CustomerReturn;
    const win = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000), label: 'today' };
    const sa = new SalesAnalyzer([orig], [], undefined, 'en', providerFor([orig], [ret]));
    const m = sa.getMetrics(win);
    expect(m.totalRevenue).toBe(0);                // original out of window
    expect(m.netRevenueCents).toBe(-8000);         // refund recognized → negative, unclamped
    expect(m.netRevenueCents).toBeLessThan(0);
  });

  it('17. the SAME metric definition is used across two compared ranges', () => {
    const sales = [
      aSale({ id: 'a', createdAt: now(), total: 6000 }),
      aSale({ id: 'b', createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), total: 4000 }),
    ];
    const sa = new SalesAnalyzer(sales, [], undefined, 'en', providerFor(sales));
    const r1 = sa.getMetrics({ start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000), label: 'r1' });
    const r2 = sa.getMetrics({ start: new Date(Date.now() - 4 * 86_400_000), end: new Date(Date.now() - 2 * 86_400_000), label: 'r2' });
    // Both totals are canonical grossSalesCents for their range — one metric.
    expect(r1.totalRevenue).toBe(6000);
    expect(r2.totalRevenue).toBe(4000);
  });

  it('payment breakdown + category breakdown reconcile to canonical (test 18)', () => {
    const sales = [
      aSale({ id: 'c1', paymentMethod: 'cash', total: 10000, items: [mkItem({ name: 'Case', category: 'accessory' as SaleItem['category'], price: 10000, qty: 1, cost: 4000 })] }),
      aSale({ id: 'c2', paymentMethod: 'card', total: 5000, items: [mkItem({ name: 'Cable', category: 'accessory' as SaleItem['category'], price: 5000, qty: 1, cost: 2000 })] }),
    ];
    const sa = new SalesAnalyzer(sales, [], undefined, 'en', providerFor(sales));
    const w = wideWindow();
    const c = computeCanonicalMoneyForRange({ sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [], settings: SETTINGS }, localDayRangeForWindow(w));
    const m = sa.getMetrics(w);
    expect(m.paymentMethodBreakdown.cash).toBe(c.cashCents);
    expect(m.paymentMethodBreakdown.card).toBe(c.cardCents);
    const canonAccessory = c.categoriesByRevenue.find((x) => x.name.toLowerCase() === 'accessory')!;
    expect(m.categoryBreakdown['Accessory'] ?? m.categoryBreakdown['accessory']).toBe(canonAccessory.revenueCents);
  });

  it('13. best-selling ranking = single metric (gross item revenue) with deterministic tie-break', () => {
    const sales = [
      aSale({ id: 's1', items: [mkItem({ name: 'Beta', price: 3000, qty: 2, cost: 1000 })] }),   // 6000
      aSale({ id: 's2', items: [mkItem({ name: 'Alpha', price: 2000, qty: 3, cost: 500 })] }),    // 6000 (tie)
      aSale({ id: 'v', status: 'voided' as Sale['status'], items: [mkItem({ name: 'Beta', price: 3000, qty: 99, cost: 1000 })] }),
    ];
    const sa = new SalesAnalyzer(sales, [], undefined, 'en', providerFor(sales));
    const top = sa.getBestSellingItems(5);
    // equal revenue (6000) → tie broken by name asc: Alpha before Beta.
    expect(top.map((t) => t.name)).toEqual(['Alpha', 'Beta']);
    expect(top[0].revenue).toBe(6000);
    expect(top[1].revenue).toBe(6000);             // voided qty 99 excluded
  });
});

// ══ FINANCIAL ANALYZER (authoritative margin/profitability = canonical) ══

describe('I2B-2.1 Financial analyzer — canonical margin/profitability', () => {
  function fin(sales: Sale[]) {
    return new FinancialAnalyzer(sales, [], [], undefined, 'en', providerFor(sales));
  }
  function canon(sales: Sale[], w: { start: Date; end: Date }) {
    return computeCanonicalMoneyForRange({ sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [], settings: SETTINGS }, localDayRangeForWindow(w));
  }

  it('grossMargin + marginMeaningful come from canonical; voided excluded', () => {
    const sales = [
      aSale({ id: 'ok', total: 10000, subtotal: 10000, items: [mkItem({ name: 'X', price: 10000, qty: 1, cost: 6000 })] }),
      aSale({ id: 'void', total: 50000, subtotal: 50000, status: 'voided' as Sale['status'], items: [mkItem({ name: 'Y', price: 50000, qty: 1, cost: 0 })] }),
    ];
    const w = wideWindow();
    const c = canon(sales, w);
    const m = fin(sales).getMetrics(w);
    const expected = Math.round((c.grossItemProfitCents / c.subtotalBeforeTaxCents) * 100 * 100) / 100;
    expect(m.grossMargin).toBe(expected);
    expect(m.grossMargin).toBe(40);                // (10000−6000)/10000, voided excluded
    expect(m.marginMeaningful).toBe(c.profitMarginMeaningful);
    expect(m.creditCardFees).toBe(Math.round(c.grossSalesCents * 0.029 + c.txCount * 30));
  });

  it('marginMeaningful FALSE on a zero-basis window (compat grossMargin 0)', () => {
    const sales = [aSale({ id: 'z', total: 5000, subtotal: 0, items: [mkItem({ name: 'X', price: 5000, qty: 1, cost: 2000 })] })];
    const m = fin(sales).getMetrics(wideWindow());
    expect(m.marginMeaningful).toBe(false);
    expect(m.grossMargin).toBe(0);
  });

  it('profitability by category = canonical categoriesByRevenue; voided excluded', () => {
    const sales = [
      aSale({ id: 'ok', items: [mkItem({ name: 'A', category: 'accessory' as SaleItem['category'], price: 3000, qty: 1, cost: 1000 })] }),
      aSale({ id: 'void', status: 'voided' as Sale['status'], items: [mkItem({ name: 'B', category: 'accessory' as SaleItem['category'], price: 9000, qty: 1, cost: 0 })] }),
    ];
    const w = wideWindow();
    const c = canon(sales, w);
    const prof = fin(sales).getProfitabilityByCategory(w);
    const canonAccessory = c.categoriesByRevenue.find((x) => x.name.toLowerCase() === 'accessory')!;
    const key = Object.keys(prof).find((k) => k.toLowerCase() === 'accessory')!;
    expect(prof[key].revenue).toBe(canonAccessory.revenueCents);
    expect(prof[key].cost).toBe(canonAccessory.costCents);
    expect(prof[key].profit).toBe(canonAccessory.profitCents);
    expect(prof[key].revenue).toBe(3000);          // voided $90 excluded
  });

  it('getMetrics without a canonical provider throws (no silent reduce)', () => {
    expect(() => new FinancialAnalyzer([aSale({ id: 'x' })], []).getMetrics()).toThrow(/canonical money provider/);
  });
});

// ══ Engine canonical range provider — scenario coverage (the analyzers' source) ══

describe('I2B-2.1 engine.getCanonicalMoneyForWindow — scenario parity (tests 1-12 source)', () => {
  const AT = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const win = () => ({ start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) });

  it('exchange with COGS + tax split flows through unchanged', () => {
    const original = mkSale({ id: 'exo', createdAt: AT(9), total: 5000, subtotal: 5000, items: [mkItem({ id: 'li-x', name: 'Case', price: 5000, qty: 1, cost: 2000 })] });
    const exchangeReturn: CustomerReturn = {
      id: 'exr', returnNumber: 'RTN-EX', originalInvoice: original.invoiceNumber, originalSaleId: 'exo',
      customerName: 'X', customerPhone: '', employeeName: 'op', createdAt: AT(15), reason: 'defective', resolution: 'exchange', notes: '',
      items: [{ id: 'li-x', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000, exchangeSaleId: 'exrepl',
    } as unknown as CustomerReturn;
    // Replacement total nets the exchange credit: $80 goods − $50 credit = $30.
    const replacement = mkSale({ id: 'exrepl', createdAt: AT(15), subtotal: 3000, total: 3000, items: [
      mkItem({ name: 'Better', price: 8000, qty: 1, cost: 3000 }),
      mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
    ] });
    const engine = buildEngine([original, replacement], { customerReturns: [exchangeReturn] });
    const c = engine.getCanonicalMoneyForWindow(win());
    expect(c.netSalesCents).toBe(8000);
    expect(c.totalCostCents).toBe(3000);
    expect(c.totalProfitCents).toBe(5000);
  });

  it('standalone repair + unlock revenue is included in canonical gross', () => {
    const repair = { id: 'rep', customerId: 'x', status: 'picked_up', balance: 0, total: 9000, laborCost: 2000, parts: [{ id: 'p', name: 'Screen', price: 0, cost: 1500, qty: 1 }], createdAt: AT(10) };
    const unlock = { id: 'unl', customerId: 'x', status: 'completed', balance: 0, price: 4000, cost: 500, createdAt: AT(11) };
    const engine = new IntelligenceEngine(
      [] as unknown as Sale[], [], [], [repair] as never,
      { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { unlocks: [unlock], customerReturns: [], settings: SETTINGS } as never,
    );
    const c = engine.getCanonicalMoneyForWindow(win());
    expect(c.grossSalesCents).toBeGreaterThan(0);
    expect(c.standaloneRepairCount + c.standaloneUnlockCount).toBe(2);
  });

  it('consolidated multi-store scope: canonical over the combined snapshot', () => {
    const sales = [
      mkSale({ id: 'A1', createdAt: AT(9), customerId: undefined, ...( { storeId: 'A' } as Partial<Sale>), total: 6000, subtotal: 6000 }),
      mkSale({ id: 'B1', createdAt: AT(10), customerId: undefined, ...( { storeId: 'B' } as Partial<Sale>), total: 7000, subtotal: 7000 }),
    ];
    const engine = buildEngine(sales, { customers: [] });
    const c = engine.getCanonicalMoneyForWindow(win());
    expect(c.grossSalesCents).toBe(13000);
  });
});
