// ============================================================
// CELLHUB-INTELLIGENCE-I2B-0 — Customer 360 profit truth tests.
//
// Includes the JENNY MIRANDA production reproduction: seven $68.99 AT&T
// payments with a $65.00 commissionable base, AT&T configured at 10%.
// The legacy pipeline's exact defective outputs ($43.55 / 9.0% / 94%) are
// LOCKED as a regression fixture with their mechanical explanation.
// All expected money values come from the canonical service semantics —
// no financial formulas are re-implemented here.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Customer, Sale, SaleItem, Repair, CustomerReturn, InventoryItem } from '@/store/types';
import { computeCustomerMoneyProfile, attributeCustomerCollections } from './customerMoneyProfile';
import type { CustomerMoneyProfileInput } from './customerMoneyProfile';
import { computeCustomerProfit, adjustSalesItemCosts } from '@/utils/customerProfit';
import { normalizeLocalDayRange } from '@/utils/reportRange';

const JENNY: Customer = {
  id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932',
} as unknown as Customer;

const SETTINGS: { carrierCommissions?: Record<string, number>; defaultCommissionRate?: number } =
  { carrierCommissions: { 'AT&T': 0.10 }, defaultCommissionRate: 0.07 };

let idSeq = 0;
function mkItem(over: Partial<SaleItem>): SaleItem {
  return {
    id: `it-${++idSeq}`, name: 'Item', category: 'accessory' as SaleItem['category'],
    price: 0, qty: 1, cbeEligible: false, taxable: true, ...over,
  } as SaleItem;
}
function mkSale(over: Partial<Sale>): Sale {
  return {
    id: `s-${++idSeq}`, invoiceNumber: `INV-${idSeq}`, items: [], subtotal: 0,
    taxAmount: 0, cbeTotal: 0, total: 0, customerId: 'cust-jenny', customerPhone: '8054523932',
    paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'], createdAt: '2026-06-10T12:00:00', ...over,
  } as Sale;
}
function profileInput(over: Partial<CustomerMoneyProfileInput>): CustomerMoneyProfileInput {
  return {
    customer: JENNY,
    sales: [], repairs: [], unlocks: [], layaways: [], specialOrders: [],
    customerReturns: [], inventory: [], settings: SETTINGS, ...over,
  };
}

/** One Jenny AT&T monthly payment: $65 commissionable + $3.58 utility tax
 *  + $0.41 mobility surcharge = $68.99 collected. Exact persisted fields. */
function jennyPayment(month: number, over: Partial<SaleItem> = {}): Sale {
  return mkSale({
    createdAt: `2026-${String(month).padStart(2, '0')}-05T10:00:00`,
    items: [mkItem({
      name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'],
      price: 6500, qty: 1, carrier: 'AT&T', phoneNumber: '8054523932', ...over,
    })],
    subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
  });
}

describe('I2B-0 test 1 — JENNY MIRANDA reconciliation (the required example)', () => {
  const sales = [1, 2, 3, 4, 5, 6, 7].map((m) => jennyPayment(m));
  const profile = computeCustomerMoneyProfile(profileInput({ sales }));

  it('7 × $68.99 = $482.93 total collected', () => {
    expect(profile.totalCollectedCents).toBe(48293);
  });
  it('7 × $65.00 = $455.00 commissionable (taxes/surcharges excluded — tests 8/9/10)', () => {
    expect(profile.profitBearingRevenueCents).toBe(45500);
  });
  it('AT&T configured 10% → $45.50 profit, margin 10.0% (NOT 9.0%)', () => {
    expect(profile.profitCents).toBe(4550);
    expect(profile.marginPercent).toBe(10);
    expect(profile.marginMeaningful).toBe(true);
  });
  it('coverage: configured commission = EXACT basis → 100%, nothing estimated (test 24)', () => {
    expect(profile.exactCoveragePercent).toBe(100);
    expect(profile.estimatedPercent).toBe(0);
    expect(profile.unavailablePercent).toBe(0);
    expect(profile.profitEstimated).toBe(false);
  });
  it('transactions and average ticket', () => {
    expect(profile.transactionCount).toBe(7);
    expect(profile.averageTicketCents).toBe(Math.round(48293 / 7));
  });
  it('invoice-level economics: each payment explains as $68.99 = $65.00 + $3.99 taxes, profit $6.50', () => {
    expect(profile.invoiceEconomics.length).toBe(7);
    for (const inv of profile.invoiceEconomics) {
      expect(inv.totalCollectedCents).toBe(6899);
      expect(inv.profitBearingCents).toBe(6500);
      expect(inv.taxAndPassThroughCents).toBe(399);
      expect(inv.profitCents).toBe(650);
      expect(inv.basis).toBe('exact_configured_commission');
    }
  });
  it('test 29: summary profit === Σ invoice-level profit (no returns in this history)', () => {
    const sum = profile.invoiceEconomics.reduce((s, i) => s + i.profitCents, 0);
    expect(profile.profitCents).toBe(sum);
  });
});

describe('I2B-0 test 2 — the OLD $43.55 / 9.0% / 94% defect, mechanically explained', () => {
  // Six payments resolve the configured 10%; ONE historical invoice carries
  // a stamped 7% commission (pre-dating the AT&T config). That is the only
  // arithmetic that produces exactly $43.55: 6×$6.50 + $4.55.
  const sales = [1, 2, 3, 4, 5, 6].map((m) => jennyPayment(m))
    .concat([jennyPayment(7, { ...( { commissionRate: 0.07 } as Partial<SaleItem>) })]);

  it('legacy pipeline reproduces the production screen EXACTLY (regression lock)', () => {
    const adjusted = adjustSalesItemCosts(sales, SETTINGS);
    const legacy = computeCustomerProfit(adjusted, []);
    expect(legacy.profit).toBe(4355);                          // $43.55 ✓
    expect(Math.round(legacy.margin * 10) / 10).toBe(9);       // 9.0% — profit ÷ tax-inclusive total (the defect)
    expect(Math.round(legacy.costCoverage * 100)).toBe(94);    // "94% cost data" — items 45500 / totals 48293 (structural artifact)
  });

  it('new pipeline: same history, honest numbers — stamped 7% respected (test 4), margin over commissionable', () => {
    const profile = computeCustomerMoneyProfile(profileInput({ sales }));
    expect(profile.totalCollectedCents).toBe(48293);
    expect(profile.profitBearingRevenueCents).toBe(45500);
    expect(profile.profitCents).toBe(4355);                    // stamped history is preserved, never rewritten
    expect(profile.marginPercent).toBeCloseTo((4355 / 45500) * 100, 5); // 9.57% of the commissionable base
    expect(profile.exactCoveragePercent).toBe(100);            // stamped + configured = both EXACT
    expect(profile.profitEstimated).toBe(false);
    const stamped = profile.invoiceEconomics.filter((i) => i.basis === 'exact_stamped_commission');
    expect(stamped.length).toBe(1);                            // exactly which invoice, and why
    expect(stamped[0].profitCents).toBe(455);
  });
});

describe('I2B-0 tests 3-7 — commission precedence', () => {
  const one = (item: Partial<SaleItem>, settings = SETTINGS) =>
    computeCustomerMoneyProfile(profileInput({ sales: [jennyPayment(1, item)], settings }));

  it('3/5: configured AT&T 10% applies when no stamp exists', () => {
    expect(one({}).profitCents).toBe(650);
    expect(one({}).invoiceEconomics[0].basis).toBe('exact_configured_commission');
  });
  it('4: historical stamped commission takes precedence over configuration', () => {
    const p = one({ ...( { commissionRate: 0.15 } as Partial<SaleItem>) });
    expect(p.profitCents).toBe(Math.round(6500 * 0.15));
    expect(p.invoiceEconomics[0].basis).toBe('exact_stamped_commission');
  });
  it('6: missing carrier rate → configured default, marked as configured source', () => {
    const p = one({ carrier: 'UnknownCarrier' }, { carrierCommissions: {}, defaultCommissionRate: 0.05 });
    expect(p.profitCents).toBe(Math.round(6500 * 0.05));
    expect(p.invoiceEconomics[0].basis).toBe('exact_configured_commission');
  });
  it('7: NO safe rate anywhere → flagged estimated, never presented as exact', () => {
    const p = one({ carrier: 'UnknownCarrier' }, {});
    // Canonical economics fall to the historical 0.07 tail — the money is
    // computed, but the profile FLAGS it as estimated.
    expect(p.invoiceEconomics[0].basis).toBe('estimated');
    expect(p.profitEstimated).toBe(true);
    expect(p.estimatedPercent).toBe(100);
  });
});

describe('I2B-0 tests 8-13 — exclusions and cost tiers', () => {
  it('11: CBE and screen fee are pass-through — never commissionable', () => {
    const sale = mkSale({
      items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, cbeTotal: 200, screenFeeTotal: 300, total: 5950,
    });
    const p = computeCustomerMoneyProfile(profileInput({ sales: [sale] }));
    expect(p.totalCollectedCents).toBe(5950);
    expect(p.profitBearingRevenueCents).toBe(5000);
    expect(p.invoiceEconomics[0].taxAndPassThroughCents).toBe(950);
  });
  it('12: explicit zero cost stays zero (never replaced)', () => {
    const sale = mkSale({ items: [mkItem({ name: 'Freebie', price: 1000, qty: 1, cost: 0 })], subtotal: 1000, total: 1000 });
    const inv = [{ id: 'i1', name: 'Freebie', cost: 700 } as unknown as InventoryItem];
    const p = computeCustomerMoneyProfile(profileInput({ sales: [sale], inventory: inv }));
    expect(p.profitCents).toBe(1000);
    expect(p.invoiceEconomics[0].basis).toBe('exact_stamped_cost');
  });
  it('13: missing legacy cost → canonical inventory fallback, classified inventory_fallback (exact tier)', () => {
    const legacyItem = mkItem({ name: 'Old Case', price: 4000, qty: 1 });
    delete (legacyItem as Partial<SaleItem>).cost;
    const sale = mkSale({ items: [legacyItem], subtotal: 4000, total: 4000 });
    const inv = [{ id: 'i2', name: 'Old Case', cost: 1500 } as unknown as InventoryItem];
    const p = computeCustomerMoneyProfile(profileInput({ sales: [sale], inventory: inv }));
    expect(p.profitCents).toBe(2500);
    expect(p.invoiceEconomics[0].basis).toBe('inventory_fallback');
    expect(p.exactCoveragePercent).toBe(100);
  });
  it('26: cost unavailable anywhere → unavailable warning percentage', () => {
    const mystery = mkItem({ name: 'Mystery', price: 2000, qty: 1 });
    delete (mystery as Partial<SaleItem>).cost;
    const p = computeCustomerMoneyProfile(profileInput({ sales: [mkSale({ items: [mystery], subtotal: 2000, total: 2000 })] }));
    expect(p.unavailablePercent).toBe(100);
    expect(p.exactCoveragePercent).toBe(0);
  });
});

describe('I2B-0 tests 14-18 — returns, exchange, negative history (canonical reuse)', () => {
  it('14: FULL return nets the customer to zero — never double-subtracted', () => {
    const original = mkSale({
      id: 'j-full', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-f', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const ret: CustomerReturn = {
      id: 'r-full', returnNumber: 'RTN-F', originalInvoice: original.invoiceNumber,
      originalSaleId: 'j-full', customerName: 'JENNY MIRANDA', customerPhone: '8054523932', employeeName: '',
      createdAt: '2026-06-11T10:00:00', reason: 'defective', resolution: 'cash', notes: '',
      items: [{ id: 'li-f', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 450, totalCents: 5450,
    } as CustomerReturn;
    const p = computeCustomerMoneyProfile(profileInput({ sales: [original], customerReturns: [ret] }));
    expect(p.totalCollectedCents).toBe(5450);
    expect(p.returnsCents).toBe(5450);
    expect(p.profitCents).toBe(0);
    expect(p.marginMeaningful).toBe(false);
  });

  it('15/16: partial return + cross-period return reverse exactly once', () => {
    const original = mkSale({
      id: 'j-part',
      items: [mkItem({ id: 'li-p', name: 'Case', price: 2000, qty: 5, cost: 800 })],
      subtotal: 10000, total: 10000,
    });
    const ret: CustomerReturn = {
      id: 'r-part', returnNumber: 'RTN-P', originalInvoice: original.invoiceNumber,
      originalSaleId: 'j-part', customerName: 'JENNY MIRANDA', customerPhone: '8054523932', employeeName: '',
      createdAt: '2026-07-01T10:00:00', // later period — still attributed via originalSaleId
      reason: 'changed_mind', resolution: 'cash', notes: '',
      items: [{ id: 'li-p', name: 'Case', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, taxCents: 0, totalCents: 2000,
    } as CustomerReturn;
    const p = computeCustomerMoneyProfile(profileInput({ sales: [original], customerReturns: [ret] }));
    expect(p.returnsCents).toBe(2000);
    expect(p.profitCents).toBe(6000 - 1200); // exact per-unit reversal (2000−800)
    expect(p.profitEstimated).toBe(false);
  });

  it('17: exchange — credit once, returned COGS restored (canonical I1.2/I1.3 behavior)', () => {
    const original = mkSale({
      id: 'j-ex', items: [mkItem({ id: 'li-x', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn: CustomerReturn = {
      id: 'r-ex', returnNumber: 'RTN-X', originalInvoice: original.invoiceNumber,
      originalSaleId: 'j-ex', customerName: 'JENNY MIRANDA', customerPhone: '8054523932', employeeName: '',
      createdAt: '2026-06-12T10:00:00', reason: 'changed_mind', resolution: 'exchange', notes: '',
      items: [{ id: 'li-x', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 0, totalCents: 5000,
    } as CustomerReturn;
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: 3000, total: 3000,
    });
    const p = computeCustomerMoneyProfile(profileInput({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    expect(p.totalCollectedCents).toBe(8000);
    expect(p.profitCents).toBe(5000); // $80 revenue − $30 final COGS
  });

  it('18: refund-only customer history → NEGATIVE profit preserved, margin not meaningful, no NaN (test 27)', () => {
    // Cross-period-shaped: only the return falls in the queried range.
    const original = mkSale({
      id: 'j-neg', createdAt: '2026-05-01T10:00:00', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-n', name: 'Case', price: 10000, qty: 1, cost: 4000 })],
      subtotal: 10000, total: 10000,
    });
    const ret: CustomerReturn = {
      id: 'r-neg', returnNumber: 'RTN-N', originalInvoice: original.invoiceNumber,
      originalSaleId: 'j-neg', customerName: 'JENNY MIRANDA', customerPhone: '8054523932', employeeName: '',
      createdAt: '2026-06-15T10:00:00', reason: 'defective', resolution: 'cash', notes: '',
      items: [{ id: 'li-n', name: 'Case', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 0, totalCents: 10000 }] as CustomerReturn['items'],
      subtotalCents: 10000, taxCents: 0, totalCents: 10000,
    } as CustomerReturn;
    // Range = June only → the original (May) is out of range, the refund in.
    const p = computeCustomerMoneyProfile(profileInput({
      sales: [original], customerReturns: [ret],
      periodRange: normalizeLocalDayRange('2026-06-01', '2026-06-30'),
    }));
    expect(p.totalCollectedCents).toBe(0);
    expect(p.profitCents).toBe(-(10000 - 4000)); // −$60 exact reversal
    expect(p.marginMeaningful).toBe(false);
    expect(Number.isFinite(p.marginPercent)).toBe(true);
  });
});

describe('I2B-0 test 19 — mixed history (product + AT&T payment + repair + return)', () => {
  const repair: Repair = { id: 'R-mix', parts: [{ cost: 1500, qty: 1 }], status: 'in_progress', createdAt: '2026-06-01T09:00:00' } as unknown as Repair;
  const productSale = mkSale({
    id: 'mix-prod', items: [mkItem({ id: 'li-mp', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
    subtotal: 5000, salesTax: 450, total: 5450,
  });
  const payment = jennyPayment(6);
  const repairSale = mkSale({
    id: 'mix-rep', items: [mkItem({ name: 'Screen repair', repairId: 'R-mix', price: 8000, qty: 1, taxable: false })],
    subtotal: 8000, total: 8000,
  });
  const ret: CustomerReturn = {
    id: 'r-mix', returnNumber: 'RTN-M', originalInvoice: productSale.invoiceNumber,
    originalSaleId: 'mix-prod', customerName: 'JENNY MIRANDA', customerPhone: '8054523932', employeeName: '',
    createdAt: '2026-06-20T10:00:00', reason: 'defective', resolution: 'cash', notes: '',
    items: [{ id: 'li-mp', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
    subtotalCents: 5000, taxCents: 450, totalCents: 5450,
  } as CustomerReturn;
  const p = computeCustomerMoneyProfile(profileInput({
    sales: [productSale, payment, repairSale], repairs: [repair], customerReturns: [ret],
  }));

  it('total collected reconciles; taxes excluded from margin denominator', () => {
    expect(p.totalCollectedCents).toBe(5450 + 6899 + 8000);
    // profit-bearing: 5000 + 6500 + 8000 − returned 5000 + 0 exchange = 14500
    expect(p.profitBearingRevenueCents).toBe(5000 + 6500 + 8000 - 5000);
  });
  it('profit = attributable canonical economics, return reversed exactly once', () => {
    // product 3000 + payment 650 + repair (8000−1500 parts) 6500 − reversal 3000 = 7150
    expect(p.profitCents).toBe(3000 + 650 + 6500 - 3000);
  });
  it('transaction count does not duplicate the linked repair (POS row only)', () => {
    expect(p.transactionCount).toBe(3);
  });
  it('test 29: summary === Σ invoices − return reversal (identity over exposed fields)', () => {
    const sumInvoices = p.invoiceEconomics.reduce((s, i) => s + i.profitCents, 0);
    expect(p.profitCents).toBe(
      sumInvoices
      - p.canonical.returnedProfitReversalCents
      + p.canonical.exchangeReturnedCostReversalCents
      + p.canonical.exchangeTaxRefundedCents,
    );
  });
});

describe('I2B-0 tests 20-23 — identity and scope', () => {
  it('20/21: attribution by customerId, and by normalized phone for legacy unlinked sales', () => {
    const byId = mkSale({ customerId: 'cust-jenny', customerPhone: '' });
    const byPhone = mkSale({ customerId: undefined, customerPhone: '(805) 452-3932' });
    const foreign = mkSale({ customerId: 'cust-other', customerPhone: '8054523932' }); // linked to ANOTHER id
    const att = attributeCustomerCollections(JENNY, {
      sales: [byId, byPhone, foreign], repairs: [], unlocks: [], layaways: [], specialOrders: [], customerReturns: [],
    });
    expect(att.sales.map((s) => s.id)).toEqual([byId.id, byPhone.id]); // foreign NEVER inherited
  });

  it('22: two customers with the same NAME stay separate (no name matching exists)', () => {
    const otherJenny: Customer = { id: 'cust-jenny-2', name: 'JENNY MIRANDA', phone: '8887776666' } as unknown as Customer;
    const sale1 = mkSale({ customerId: 'cust-jenny', customerPhone: '8054523932', total: 100, subtotal: 100, items: [mkItem({ name: 'A', price: 100, qty: 1, cost: 0 })] });
    const sale2 = mkSale({ customerId: 'cust-jenny-2', customerPhone: '8887776666', total: 20000, subtotal: 20000, items: [mkItem({ name: 'B', price: 20000, qty: 1, cost: 0 })] });
    const p1 = computeCustomerMoneyProfile(profileInput({ sales: [sale1, sale2] }));
    const p2 = computeCustomerMoneyProfile(profileInput({ customer: otherJenny, sales: [sale1, sale2] }));
    expect(p1.totalCollectedCents).toBe(100);
    expect(p2.totalCollectedCents).toBe(20000);
  });

  it('23: store scope is inherited — profile over store-scoped collections sees only that store', () => {
    // The collections arrive pre-scoped from AppProvider (I2A.1); the profile
    // never widens them. Simulated: only store-A sales are passed in.
    const aOnly = [jennyPayment(3)];
    const p = computeCustomerMoneyProfile(profileInput({ sales: aOnly }));
    expect(p.transactionCount).toBe(1);
  });
});

describe('I2B-0 tests 25/27/28 — flags, stability', () => {
  it('25: estimated portion produces the estimated warning percentage', () => {
    const sales = [jennyPayment(1), jennyPayment(2, { carrier: 'NoSuchCarrier' })];
    const p = computeCustomerMoneyProfile(profileInput({ sales, settings: { carrierCommissions: { 'AT&T': 0.10 } } }));
    // Second payment has no configured/default/stamped rate → estimated.
    expect(p.estimatedPercent).toBe(50);
    expect(p.profitEstimated).toBe(true);
  });

  it('27/28: no NaN/Infinity; inputs immutable; deterministic', () => {
    const sales = [1, 2, 3].map((m) => jennyPayment(m));
    const input = profileInput({ sales });
    const snapshot = JSON.stringify(input.sales);
    const a = computeCustomerMoneyProfile(input);
    const b = computeCustomerMoneyProfile(input);
    expect(a.profitCents).toBe(b.profitCents);
    expect(a.marginPercent).toBe(b.marginPercent);
    expect(Number.isFinite(a.marginPercent)).toBe(true);
    expect(Number.isFinite(a.averageTicketCents)).toBe(true);
    expect(JSON.stringify(input.sales)).toBe(snapshot);
    const empty = computeCustomerMoneyProfile(profileInput({}));
    expect(empty.profitCents).toBe(0);
    expect(empty.marginMeaningful).toBe(false);
    expect(Number.isFinite(empty.marginPercent)).toBe(true);
  });
});
