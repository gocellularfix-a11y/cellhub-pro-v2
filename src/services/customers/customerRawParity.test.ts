// ============================================================
// CELLHUB-INTELLIGENCE-I2B-0.2 — RAW vs ADAPTED customer parity.
//
// The IntelligenceEngine adapts collections at construction (adaptSale /
// adaptRepair / adaptInventory). Canonical customer money must NEVER read
// those adapted arrays — it reads the raw scoped snapshot
// (canonicalMoneySnapshot), exactly like Reports and Customer 360. These
// tests exercise the REAL constructor adaptation path with legacy raw
// fixtures and assert the public engine surface equals the raw profile.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Customer, Sale, SaleItem, Repair, CustomerReturn } from '@/store/types';
import { computeCustomerMoneyProfile } from './customerMoneyProfile';
import type { CustomerMoneyProfileInput } from './customerMoneyProfile';
import { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';

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
function mkReturn(over: Partial<CustomerReturn>): CustomerReturn {
  return {
    id: `ret-${++idSeq}`, returnNumber: `RTN-${idSeq}`, originalInvoice: '',
    originalSaleId: null, customerName: 'JENNY MIRANDA', customerPhone: '8054523932',
    employeeName: '', createdAt: '2026-06-20T15:00:00', reason: 'defective',
    resolution: 'cash', notes: '', items: [], subtotalCents: 0, taxCents: 0,
    totalCents: 0, ...over,
  } as CustomerReturn;
}
function profileInput(over: Partial<CustomerMoneyProfileInput>): CustomerMoneyProfileInput {
  return {
    customer: JENNY,
    sales: [], repairs: [], unlocks: [], layaways: [], specialOrders: [],
    customerReturns: [], inventory: [], settings: SETTINGS, ...over,
  };
}

/** REALISTIC legacy raw world exercising every attribution + adaptation edge:
 *  - direct customerId phone-payment with persisted tax/surcharge fields
 *  - legacy PHONE-linked sale (no customerId, formatted phone, legacy
 *    aggregate taxAmount, item with `quantity` instead of `qty`, NO item id)
 *  - return linked by originalSaleId
 *  - a raw repair (paid + picked up, standalone)
 *  - an unrelated customer's sale (must never leak in). */
function legacyWorld() {
  const direct = mkSale({
    id: 's-direct', createdAt: '2026-06-05T10:00:00',
    items: [mkItem({
      name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'],
      price: 6500, qty: 1, carrier: 'AT&T',
    })],
    subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
  });
  const phoneLinked = {
    ...mkSale({
      id: 's-phone-legacy', createdAt: '2026-06-01T09:00:00',
      customerId: undefined, customerPhone: '(805) 452-3932',
      subtotal: 4000, taxAmount: 310, total: 4310,
    }),
    items: [{
      // legacy raw line: NO id, `quantity` instead of `qty`
      name: 'Tempered Glass', category: 'accessory', price: 2000, quantity: 2, cost: 600, taxable: true,
    }],
  } as unknown as Sale;
  const linkedReturn = mkReturn({
    originalSaleId: 's-direct', originalInvoice: direct.invoiceNumber,
    items: [{ id: direct.items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
    subtotalCents: 6500, taxCents: 399, totalCents: 6899,
  });
  const repair = {
    id: 'rep-raw', customerId: 'cust-jenny', customerName: 'JENNY MIRANDA',
    customerPhone: '8054523932', status: 'picked_up', balance: 0, total: 9000,
    laborCost: 2500, parts: [{ id: 'p1', name: 'Screen', price: 0, cost: 1500, qty: 1 }],
    createdAt: '2026-06-12T12:00:00',
  } as unknown as Repair;
  const stranger = mkSale({
    id: 's-stranger', customerId: 'cust-other', customerPhone: '8051112222',
    items: [mkItem({ name: 'Case', price: 1000, cost: 400 })], subtotal: 1000, total: 1000,
  });
  return { sales: [direct, phoneLinked, stranger], repairs: [repair], customerReturns: [linkedReturn] };
}

function buildEngine(w: { sales: Sale[]; repairs: Repair[]; customerReturns: CustomerReturn[] }) {
  // REAL constructor — sales/repairs/inventory go through the adapters here.
  return new IntelligenceEngine(
    w.sales, [JENNY, { id: 'cust-other', name: 'OTHER', phone: '8051112222' } as unknown as Customer],
    [], w.repairs,
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    {
      specialOrders: [], unlocks: [], layaways: [],
      customerReturns: w.customerReturns, vendorReturns: [],
      settings: SETTINGS,
    },
  );
}

describe('I2B-0.2 tests 1-8 — chat consumes RAW canonical inputs (real adaptation path)', () => {
  const world = legacyWorld();
  const rawSnapshot = JSON.stringify(world);
  const engine = buildEngine(world);
  const h = engine.getCustomerHistory('cust-jenny')!;
  const rawProfile = computeCustomerMoneyProfile(profileInput({
    sales: world.sales, repairs: world.repairs, customerReturns: world.customerReturns,
  }));

  it('1/2: engine money === raw-collections profile on every canonical field', () => {
    expect(h).not.toBeNull();
    expect(h.canonicalMoney).toEqual({
      totalCollectedCents: rawProfile.totalCollectedCents,
      profitBearingRevenueCents: rawProfile.profitBearingRevenueCents,
      profitCents: rawProfile.profitCents,
      marginPercent: rawProfile.marginPercent,
      marginMeaningful: rawProfile.marginMeaningful,
      transactionCount: rawProfile.transactionCount,
      averageTicketCents: rawProfile.averageTicketCents,
      returnsCents: rawProfile.returnsCents,
      netAfterReturnsCents: rawProfile.netAfterReturnsCents,
      profitEstimated: rawProfile.profitEstimated,
      estimatedPercent: rawProfile.estimatedPercent,
      unavailablePercent: rawProfile.unavailablePercent,
    });
  });
  it('3: the legacy PHONE-linked sale is in the money on BOTH surfaces (and the stranger is not)', () => {
    // direct 6899 + phone-linked 4310 + standalone repair 9000; stranger excluded.
    expect(rawProfile.totalCollectedCents).toBe(6899 + 4310 + 9000);
    expect(h.grossRevenue).toBe(rawProfile.totalCollectedCents);
  });
  it('4: firstVisit/lastVisit come from the SAME attributed population as the money', () => {
    expect(h.firstVisit?.getTime()).toBe(rawProfile.firstVisitAt?.getTime());
    expect(h.lastVisit?.getTime()).toBe(rawProfile.lastVisitAt?.getTime());
    // The phone-linked legacy sale (June 1) IS the first visit — no
    // contradiction with the financial profile.
    expect(h.firstVisit?.toISOString().slice(0, 10)).toBe('2026-06-01');
  });
  it('5: top items include the raw legacy line (quantity-style, no ID)', () => {
    const glass = h.topItems.find((ti) => ti.name === 'Tempered Glass');
    expect(glass).toBeTruthy();
    expect(glass!.quantity).toBe(2);
    expect(glass!.revenue).toBe(4000);
  });
  it('6: the return linked by originalSaleId agrees across surfaces', () => {
    expect(h.canonicalMoney.returnsCents).toBe(rawProfile.returnsCents);
    expect(rawProfile.returnsCents).toBe(6899);
    expect(h.totalRefunded).toBe(6899);
    expect(h.netRevenue).toBe(rawProfile.netAfterReturnsCents);
  });
  it('7: raw persisted phone-payment taxes stay intact (profit-bearing excludes 358+41)', () => {
    const inv = rawProfile.invoiceEconomics.find((i) => i.saleId === 's-direct')!;
    expect(inv.totalCollectedCents).toBe(6899);
    expect(inv.profitBearingCents).toBe(6500);
    expect(inv.taxAndPassThroughCents).toBe(399);
  });
  it('8: store scope — only the given (pre-scoped) arrays are consulted', () => {
    // 2 attributable sales + 1 standalone repair = 3 financial transactions.
    expect(h.canonicalMoney.transactionCount).toBe(3);
  });
  it('22: engine construction + history read never mutate the raw fixtures; result is deterministic', () => {
    expect(JSON.stringify(world)).toBe(rawSnapshot);
    const again = buildEngine(legacyWorld()).getCustomerHistory('cust-jenny')!;
    expect(again.canonicalMoney).toEqual(h.canonicalMoney);
  });
  it('24: no NaN/Infinity anywhere in the history money fields', () => {
    const nums = [h.grossRevenue, h.netRevenue, h.totalRefunded, h.profit, h.margin,
      h.avgTicket, h.costCoverage, ...Object.values(h.canonicalMoney).filter((v): v is number => typeof v === 'number')];
    for (const n of nums) expect(Number.isFinite(n)).toBe(true);
  });
});

describe('I2B-0.2 test 23 — Jenny full surface parity stays locked (raw engine path)', () => {
  it('$482.93 / $455.00 / $45.50 / 10.0% / 7 tx / $68.99 through the REAL engine', () => {
    const sales = [1, 2, 3, 4, 5, 6, 7].map((m) => mkSale({
      createdAt: `2026-${String(m).padStart(2, '0')}-05T10:00:00`,
      items: [mkItem({
        name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'],
        price: 6500, qty: 1, carrier: 'AT&T',
      })],
      subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
    }));
    const h = buildEngine({ sales, repairs: [], customerReturns: [] }).getCustomerHistory('cust-jenny')!;
    expect(h.canonicalMoney.totalCollectedCents).toBe(48293);
    expect(h.canonicalMoney.profitBearingRevenueCents).toBe(45500);
    expect(h.canonicalMoney.profitCents).toBe(4550);
    expect(h.canonicalMoney.marginPercent).toBe(10);
    expect(h.canonicalMoney.transactionCount).toBe(7);
    expect(h.canonicalMoney.averageTicketCents).toBe(6899);
    expect(h.canonicalMoney.profitEstimated).toBe(false);
    expect(h.canonicalMoney.unavailablePercent).toBe(0);
    expect(h.costCoverage).toBe(1); // no missing-cost warning
  });
});
