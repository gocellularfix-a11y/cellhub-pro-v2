// ============================================================
// CELLHUB-INTELLIGENCE-I2B-2 — analyzer ⇄ canonical money parity.
//
// Proves the Financial / Sales / Customer analyzer money answers use the
// established canonical services (computeReportMoneyStats /
// customerMoneyProfile) rather than legacy sum(sale.total) reduces. Customer
// expectations are computed through the canonical service and compared
// field-by-field — never a re-implemented formula. JENNY MIRANDA is the
// deterministic customer case.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { CustomerAnalyzer } from './CustomerAnalyzer';
import { SalesAnalyzer } from './SalesAnalyzer';
import { FinancialAnalyzer } from './FinancialAnalyzer';
import { computeCustomerMoneyProfile } from '@/services/customers/customerMoneyProfile';
import type { Customer, Sale, SaleItem, Repair, CustomerReturn } from '@/store/types';

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
/** Independent canonical profile — the ONLY source of expected customer values. */
function canonicalJenny(sales: Sale[], returns: CustomerReturn[] = []) {
  return computeCustomerMoneyProfile({
    customer: JENNY, sales, repairs: [], unlocks: [], layaways: [], specialOrders: [],
    customerReturns: returns, inventory: [], settings: SETTINGS,
  });
}

describe('I2B-2 Customer — Jenny deterministic case (test 19)', () => {
  const sales = jennySales();
  const engine = buildEngine(sales);

  it('engine.getCustomerValueProfiles === customerMoneyProfile (test 24)', () => {
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    const c = canonicalJenny(sales);
    expect(p.totalCollectedCents).toBe(c.totalCollectedCents);
    expect(p.profitCents).toBe(c.profitCents);
    expect(p.marginPercent).toBe(c.marginPercent);
    expect(p.transactionCount).toBe(c.transactionCount);
    expect(p.averageTicketCents).toBe(c.averageTicketCents);
  });

  it('$482.93 / $455.00 / $45.50 / 10.0% / 7 tx / $68.99', () => {
    const top = engine.getTopCustomersByValue(5);
    expect(top[0].customerId).toBe('cust-jenny');
    expect(top[0].revenueCents).toBe(48293);          // Total Collected
    expect(top[0].netAfterReturnsCents).toBe(48293);
    expect(top[0].profitCents).toBe(4550);            // AT&T 10%
    expect(top[0].marginPercent).toBe(10);
    expect(top[0].transactionCount).toBe(7);
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    expect(p.profitBearingRevenueCents).toBe(45500);  // commissionable base
    expect(p.averageTicketCents).toBe(6899);
  });

  it('configured commission is EXACT, not missing cost (test 20)', () => {
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    expect(p.exactCoveragePercent).toBe(100);
    expect(p.estimatedPercent).toBe(0);
    expect(p.profitEstimated).toBe(false);
  });

  it('CustomerAnalyzer financial methods == canonical (test 24, direct)', () => {
    const ca = new CustomerAnalyzer([JENNY], sales, undefined, 'en', () => engine.getCustomerValueProfiles());
    expect(ca.getCustomerLifetimeValue()['cust-jenny']).toBe(48293);
    expect(ca.getTopCustomers('spend')[0].id).toBe('cust-jenny');
    expect(ca.getMetrics().avgLTV).toBe(48293);       // only Jenny has activity
  });
});

describe('I2B-2 Customer — returns, transactions vs interactions, id safety (21/22/23)', () => {
  it('21. a return reduces net-after-returns but not Total Collected', () => {
    const sales = jennySales();
    const ret: CustomerReturn = {
      id: 'r1', returnNumber: 'RTN-1', originalInvoice: sales[0].invoiceNumber, originalSaleId: sales[0].id,
      customerName: 'JENNY MIRANDA', customerPhone: '8054523932', employeeName: 'op',
      createdAt: '2026-06-20T12:00:00', reason: 'defective', resolution: 'cash', notes: '',
      items: [{ id: sales[0].items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
      subtotalCents: 6500, taxCents: 399, totalCents: 6899,
    } as unknown as CustomerReturn;
    const engine = buildEngine(sales, { customerReturns: [ret] });
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    const c = canonicalJenny(sales, [ret]);
    expect(p.totalCollectedCents).toBe(48293);            // gross unchanged
    expect(p.returnsCents).toBe(c.returnsCents);
    expect(p.netAfterReturnsCents).toBe(c.netAfterReturnsCents);
    expect(p.netAfterReturnsCents).toBe(48293 - 6899);
  });

  it('22. financial transactions (7) are NOT the raw interaction count', () => {
    // 7 payments + an appointment-like extra sale row that is voided → still 7.
    const sales = [...jennySales(), mkSale({ id: 'void', status: 'voided' as Sale['status'], total: 9999 })];
    const engine = buildEngine(sales);
    expect(engine.getCustomerValueProfiles().get('cust-jenny')!.transactionCount).toBe(7);
  });

  it('23. duplicate / missing item IDs do not double-count collected', () => {
    const dup = mkSale({
      id: 'dupSale', createdAt: '2026-06-08T10:00:00',
      items: [
        mkItem({ id: 'dupI', name: 'Case', price: 1000, cost: 400 }),
        mkItem({ id: 'dupI', name: 'Case B', price: 1000, cost: 400 }),
        { ...mkItem({ name: 'NoId', price: 500, cost: 200 }), id: undefined } as unknown as SaleItem,
      ],
      subtotal: 2500, total: 2500,
    });
    const engine = buildEngine([jennyPayment(1), dup]);
    const p = engine.getCustomerValueProfiles().get('cust-jenny')!;
    const c = canonicalJenny([jennyPayment(1), dup]);
    expect(p.totalCollectedCents).toBe(c.totalCollectedCents);
    expect(p.totalCollectedCents).toBe(6899 + 2500);      // each line once, no double count
  });
});

describe('I2B-2 Customer — top-customers ranking is one metric + deterministic', () => {
  it('ranks by canonical Total Collected with deterministic id tie-break', () => {
    const a: Customer = { id: 'cust-a', name: 'A', phone: '8051110000' } as unknown as Customer;
    const b: Customer = { id: 'cust-b', name: 'B', phone: '8052220000' } as unknown as Customer;
    // Equal collected (5000 each) → stable order by id (cust-a before cust-b).
    const sales = [
      mkSale({ id: 'sa', customerId: 'cust-a', customerPhone: '8051110000', items: [mkItem({ name: 'X', price: 5000, cost: 2000 })], subtotal: 5000, total: 5000 }),
      mkSale({ id: 'sb', customerId: 'cust-b', customerPhone: '8052220000', items: [mkItem({ name: 'Y', price: 5000, cost: 2000 })], subtotal: 5000, total: 5000 }),
    ];
    const engine = buildEngine(sales, { customers: [b, a] });
    const top = engine.getTopCustomersByValue(5);
    expect(top.map((t) => t.customerId)).toEqual(['cust-a', 'cust-b']);
    expect(top[0].revenueCents).toBe(5000);
  });
});

// ── Sales / Financial analyzers: gross-activity population (voided excluded) ──

const now = () => new Date().toISOString();
function analyzerSale(over: Partial<Sale>): Sale {
  return {
    id: `as-${++seq}`, invoiceNumber: `INV-${seq}`, status: 'completed', paymentMethod: 'cash',
    total: 10000, subtotal: 10000, createdAt: now(),
    items: [mkItem({ name: 'Glass', price: 10000, qty: 1, cost: 6000 })], ...over,
  } as Sale;
}
// end 1 day in the future so today's (now()) fixtures are inside the window.
const wideWindow = () => ({ start: new Date(Date.now() - 7 * 86_400_000), end: new Date(Date.now() + 86_400_000), label: '7d' });

describe('I2B-2 Sales analyzer — canonical gross-activity (tests 13/15/16/18)', () => {
  it('15. voided sales are excluded from revenue + transaction count', () => {
    const sa = new SalesAnalyzer([
      analyzerSale({ id: 'ok', total: 10000 }),
      analyzerSale({ id: 'void', total: 99999, status: 'voided' as Sale['status'] }),
    ], []);
    const m = sa.getMetrics(wideWindow());
    expect(m.totalRevenue).toBe(10000);   // voided $999.99 excluded
    expect(m.transactionCount).toBe(1);
  });

  it('refund-audit rows are excluded (consistent with Reports)', () => {
    const sa = new SalesAnalyzer([
      analyzerSale({ id: 'ok', total: 10000 }),
      analyzerSale({ id: 'REFUND-1', invoiceNumber: 'REFUND-INV-1', total: -4000, status: 'completed' as Sale['status'] }),
    ], []);
    expect(sa.getMetrics(wideWindow()).totalRevenue).toBe(10000); // −4000 refund row not counted
  });

  it('13. best-selling ranking uses ONE metric (gross line revenue); voided excluded', () => {
    const sa = new SalesAnalyzer([
      analyzerSale({ id: 's1', items: [mkItem({ name: 'Case', price: 3000, qty: 2, cost: 1000 })] }),   // 6000
      analyzerSale({ id: 's2', items: [mkItem({ name: 'Cable', price: 2000, qty: 4, cost: 500 })] }),   // 8000
      analyzerSale({ id: 'v', status: 'voided' as Sale['status'], items: [mkItem({ name: 'Case', price: 3000, qty: 99, cost: 1000 })] }),
    ], []);
    const top = sa.getBestSellingItems(5);
    expect(top.map((t) => t.name)).toEqual(['Cable', 'Case']); // single metric = revenue
    expect(top[0].revenue).toBe(8000);
    expect(top[1].revenue).toBe(6000);                          // voided Case qty 99 excluded
  });

  it('18. a positive gross-activity total is not clamped or omitted', () => {
    const sa = new SalesAnalyzer([analyzerSale({ id: 'ok', total: 5000 })], []);
    const m = sa.getMetrics(wideWindow());
    expect(m.totalRevenue).toBe(5000);
    expect(m.totalRevenue).toBeGreaterThan(0);
  });
});

describe('I2B-2 Financial analyzer — voided excluded from revenue/margin/profitability', () => {
  it('voided sale does not inflate margin or card-fee estimate', () => {
    const fa = new FinancialAnalyzer([
      analyzerSale({ id: 'ok', total: 10000, items: [mkItem({ name: 'X', price: 10000, qty: 1, cost: 6000 })] }),
      analyzerSale({ id: 'void', total: 50000, status: 'voided' as Sale['status'], items: [mkItem({ name: 'Y', price: 50000, qty: 1, cost: 0 })] }),
    ], []);
    const m = fa.getMetrics();
    // gross margin over the ONE real $100 sale (cost $60) = 40%.
    expect(m.grossMargin).toBe(40);
    // card fee: 10000*0.029 + 1*30 = 320 (voided sale not counted).
    expect(m.creditCardFees).toBe(320);
  });

  it('profitability by category excludes voided', () => {
    const fa = new FinancialAnalyzer([
      analyzerSale({ id: 'ok', items: [mkItem({ name: 'A', category: 'accessory' as SaleItem['category'], price: 3000, qty: 1, cost: 1000 })] }),
      analyzerSale({ id: 'void', status: 'voided' as Sale['status'], items: [mkItem({ name: 'B', category: 'accessory' as SaleItem['category'], price: 9000, qty: 1, cost: 0 })] }),
    ], []);
    const prof = fa.getProfitabilityByCategory();
    expect(prof['accessory'].revenue).toBe(3000);    // voided $90 excluded
    expect(prof['accessory'].profit).toBe(2000);
  });
});
