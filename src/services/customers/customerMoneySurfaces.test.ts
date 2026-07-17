// ============================================================
// CELLHUB-INTELLIGENCE-I2B-0.1 — Customer profit SURFACE PARITY tests.
//
// Every user-facing customer-money surface (Customer 360 modal, chat
// customer history via IntelligenceEngine, customer list) must agree on
// the canonical customer economics. Expected money values come from the
// canonical profile / Reports outputs — never an independent formula.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Customer, Sale, SaleItem, Repair, CustomerReturn } from '@/store/types';
import {
  computeCustomerMoneyProfile,
  computeCustomerMoneyProfiles,
  createCustomerProfilesCache,
  traceCustomerInvoiceEconomics,
} from './customerMoneyProfile';
import type { CustomerMoneyProfileInput, CustomerProfilesBatchInput } from './customerMoneyProfile';
import { computeReportMoneyStats, checkReportMoneyInvariants, isPseudoItem } from '@/services/reports/computeReportMoneyStats';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import { canViewOwnerFinancials, FINANCIAL_PRIVACY_SETTING_KEY } from '@/utils/financialPrivacy';
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
function mkRepair(over: Partial<Repair>): Repair {
  return {
    id: `rep-${++idSeq}`, customerId: 'cust-jenny', customerName: 'JENNY MIRANDA',
    customerPhone: '8054523932', status: 'picked_up', balance: 0, total: 0,
    createdAt: '2026-06-12T12:00:00', parts: [], ...over,
  } as unknown as Repair;
}
function profileInput(over: Partial<CustomerMoneyProfileInput>): CustomerMoneyProfileInput {
  return {
    customer: JENNY,
    sales: [], repairs: [], unlocks: [], layaways: [], specialOrders: [],
    customerReturns: [], inventory: [], settings: SETTINGS, ...over,
  };
}
function batchInput(over: Partial<CustomerProfilesBatchInput>): CustomerProfilesBatchInput {
  return {
    sales: [], repairs: [], unlocks: [], layaways: [], specialOrders: [],
    customerReturns: [], inventory: [], settings: SETTINGS, ...over,
  };
}

/** One Jenny AT&T monthly payment (exact persisted fields). */
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
const jennySales = () => [1, 2, 3, 4, 5, 6, 7].map((m) => jennyPayment(m));

function buildEngine(w: {
  sales?: Sale[]; customers?: Customer[]; repairs?: Repair[]; customerReturns?: CustomerReturn[];
}): IntelligenceEngine {
  return new IntelligenceEngine(
    w.sales ?? [], w.customers ?? [JENNY], [], w.repairs ?? [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    {
      specialOrders: [], unlocks: [], layaways: [],
      customerReturns: w.customerReturns ?? [], vendorReturns: [],
      settings: SETTINGS,
    },
  );
}

// The exact canonical fields every surface must agree on (round Part B list).
function moneyFields(p: ReturnType<typeof computeCustomerMoneyProfile>) {
  return {
    totalCollectedCents: p.totalCollectedCents,
    profitBearingRevenueCents: p.profitBearingRevenueCents,
    profitCents: p.profitCents,
    marginPercent: p.marginPercent,
    marginMeaningful: p.marginMeaningful,
    transactionCount: p.transactionCount,
    averageTicketCents: p.averageTicketCents,
    returnsCents: p.returnsCents,
    netAfterReturnsCents: p.netAfterReturnsCents,
    profitEstimated: p.profitEstimated,
    estimatedPercent: p.estimatedPercent,
    unavailablePercent: p.unavailablePercent,
  };
}

describe('I2B-0.1 tests 1/4/5 — Jenny Customer 360 profile (canonical)', () => {
  const profile = computeCustomerMoneyProfile(profileInput({ sales: jennySales() }));
  it('1: $482.93 collected / $455.00 profit-bearing / $45.50 profit / 10.0% margin', () => {
    expect(profile.totalCollectedCents).toBe(48293);
    expect(profile.profitBearingRevenueCents).toBe(45500);
    expect(profile.profitCents).toBe(4550);
    expect(profile.marginPercent).toBe(10);
    expect(profile.marginMeaningful).toBe(true);
    expect(profile.profitEstimated).toBe(false);
    expect(profile.unavailablePercent).toBe(0);
    expect(profile.estimatedPercent).toBe(0);
  });
  it('4: seven FINANCIAL transactions', () => {
    expect(profile.transactionCount).toBe(7);
  });
  it('5: avg ticket $68.99 (same denominator as the transaction count)', () => {
    expect(profile.averageTicketCents).toBe(6899);
    expect(profile.averageTicketCents * profile.transactionCount).toBe(48293);
  });
});

describe('I2B-0.1 tests 2/15 — chat customer-history parity (engine → canonical)', () => {
  it('2/15: engine.getCustomerHistory agrees with the modal profile on EVERY canonical field', () => {
    const sales = jennySales();
    const engine = buildEngine({ sales });
    const h = engine.getCustomerHistory('cust-jenny');
    expect(h).not.toBeNull();
    const profile = computeCustomerMoneyProfile(profileInput({ sales }));
    expect(h!.canonicalMoney).toEqual(moneyFields(profile));
    // Legacy field names carry the canonical values.
    expect(h!.grossRevenue).toBe(48293);
    expect(h!.profit).toBe(4550);
    expect(h!.margin).toBe(10);
    expect(h!.avgTicket).toBe(6899);
    expect(h!.netRevenue).toBe(profile.netAfterReturnsCents);
    expect(h!.totalRefunded).toBe(0);
    // A fully-configured commission history is EXACT — no fake "approximate".
    expect(h!.costCoverage).toBe(1);
  });
  it('15b: parity holds WITH returns in the history', () => {
    const sales = jennySales();
    const ret = mkReturn({
      originalSaleId: sales[0].id, originalInvoice: sales[0].invoiceNumber,
      items: [{ id: sales[0].items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
      subtotalCents: 6500, taxCents: 399, totalCents: 6899,
    });
    const engine = buildEngine({ sales, customerReturns: [ret] });
    const h = engine.getCustomerHistory('cust-jenny');
    const profile = computeCustomerMoneyProfile(profileInput({ sales, customerReturns: [ret] }));
    expect(h!.canonicalMoney).toEqual(moneyFields(profile));
    expect(h!.totalRefunded).toBe(profile.returnsCents);
  });
});

describe('I2B-0.1 tests 3/16 — customer-list parity (batched profiles)', () => {
  it('3/16: the batch profile for Jenny equals the single-customer profile field-by-field', () => {
    const sales = jennySales();
    const single = computeCustomerMoneyProfile(profileInput({ sales }));
    const batch = computeCustomerMoneyProfiles([JENNY], batchInput({ sales }));
    const b = batch.get('cust-jenny')!;
    expect(moneyFields(b)).toEqual(moneyFields(single));
    expect(b.visitCount).toBe(single.visitCount);
    expect(b.lastVisitAt?.getTime()).toBe(single.lastVisitAt?.getTime());
    expect(b.invoiceEconomics).toEqual(single.invoiceEconomics);
  });
  it('16b: batch attribution matches per-customer attribution for phone-fallback + linked records', () => {
    const other: Customer = { id: 'cust-other', name: 'OTHER', phone: '8055550000' } as unknown as Customer;
    const sales = [
      jennyPayment(1),
      mkSale({ customerId: undefined, customerPhone: '(805) 452-3932', items: [mkItem({ name: 'Case', price: 1000, cost: 400 })], subtotal: 1000, total: 1000 }),
      mkSale({ customerId: 'cust-other', customerPhone: '8054523932', items: [mkItem({ name: 'X', price: 2000, cost: 500 })], subtotal: 2000, total: 2000 }),
    ];
    const batch = computeCustomerMoneyProfiles([JENNY, other], batchInput({ sales }));
    const single = computeCustomerMoneyProfile(profileInput({ sales }));
    expect(moneyFields(batch.get('cust-jenny')!)).toEqual(moneyFields(single));
    // The sale LINKED to cust-other is never inherited by Jenny's phone.
    expect(batch.get('cust-jenny')!.totalCollectedCents).toBe(6899 + 1000);
    expect(batch.get('cust-other')!.totalCollectedCents).toBe(2000);
  });
});

describe('I2B-0.1 tests 6/7/8/9 — transactions vs interactions', () => {
  it('6: an appointment never enters the financial transaction count (7-domain activity is separate)', () => {
    const sales = jennySales();
    const profile = computeCustomerMoneyProfile(profileInput({ sales }));
    // The canonical profile input has NO appointment channel at all — the
    // module-level 7-domain counter is display-only "Interactions".
    const appointments = [{ id: 'apt-1', customerId: 'cust-jenny' }];
    const interactions = sales.length + appointments.length; // modal formula shape
    expect(profile.transactionCount).toBe(7);
    expect(interactions).toBe(8);
    expect(profile.averageTicketCents).toBe(6899); // denominator unaffected
  });
  it('7: a return does not count as a new completed sale', () => {
    const sales = jennySales();
    const ret = mkReturn({
      originalSaleId: sales[0].id, originalInvoice: sales[0].invoiceNumber,
      items: [{ id: sales[0].items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
      subtotalCents: 6500, taxCents: 399, totalCents: 6899,
    });
    const profile = computeCustomerMoneyProfile(profileInput({ sales, customerReturns: [ret] }));
    expect(profile.transactionCount).toBe(7);          // unchanged
    expect(profile.returnsCents).toBe(6899);           // money DID move
    expect(profile.netAfterReturnsCents).toBe(48293 - 6899);
  });
  it('8: a POS-linked repair is not double counted', () => {
    const repair = mkRepair({ total: 8000, laborCost: 2000 });
    const sale = mkSale({
      items: [mkItem({ name: 'Repair Service', category: 'repair' as SaleItem['category'], price: 8000, repairId: repair.id })],
      subtotal: 8000, total: 8000,
    });
    const profile = computeCustomerMoneyProfile(profileInput({ sales: [sale], repairs: [repair] }));
    expect(profile.transactionCount).toBe(1);          // the sale only
    expect(profile.totalCollectedCents).toBe(8000);    // revenue once
  });
  it('9: a standalone PAID repair counts as one financial transaction with its revenue', () => {
    const repair = mkRepair({ total: 8000, laborCost: 2000, parts: [{ id: 'p1', name: 'Screen', price: 0, cost: 1000, qty: 1 }] as unknown as Repair['parts'] });
    const profile = computeCustomerMoneyProfile(profileInput({ sales: jennySales(), repairs: [repair] }));
    expect(profile.canonical.standaloneRepairCount).toBe(1);
    expect(profile.transactionCount).toBe(8);          // 7 sales + 1 standalone repair
    expect(profile.totalCollectedCents).toBe(48293 + 8000);
    // avg ticket keeps the SAME population as total collected
    expect(profile.averageTicketCents).toBe(Math.round((48293 + 8000) / 8));
  });
});

describe('I2B-0.1 tests 10-14 — gross collected vs net after returns', () => {
  it('10: no returns → net === collected, returns 0 (UI shows no subline)', () => {
    const profile = computeCustomerMoneyProfile(profileInput({ sales: jennySales() }));
    expect(profile.returnsCents).toBe(0);
    expect(profile.netAfterReturnsCents).toBe(profile.totalCollectedCents);
  });
  it('11: partial return → collected stays gross, net = canonical netSalesCents', () => {
    const sales = jennySales();
    const ret = mkReturn({
      originalSaleId: sales[2].id, originalInvoice: sales[2].invoiceNumber,
      items: [{ id: sales[2].items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
      subtotalCents: 6500, taxCents: 399, totalCents: 6899,
    });
    const profile = computeCustomerMoneyProfile(profileInput({ sales, customerReturns: [ret] }));
    expect(profile.totalCollectedCents).toBe(48293);
    expect(profile.returnsCents).toBe(6899);
    expect(profile.netAfterReturnsCents).toBe(profile.canonical.netSalesCents);
    expect(profile.netAfterReturnsCents).toBe(41394);
  });
  it('12: full refund of the only sale → net exactly 0', () => {
    const sale = jennyPayment(6);
    const ret = mkReturn({
      originalSaleId: sale.id, originalInvoice: sale.invoiceNumber,
      items: [{ id: sale.items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
      subtotalCents: 6500, taxCents: 399, totalCents: 6899,
    });
    const profile = computeCustomerMoneyProfile(profileInput({ sales: [sale], customerReturns: [ret] }));
    expect(profile.totalCollectedCents).toBe(6899);
    expect(profile.netAfterReturnsCents).toBe(0);
    expect(profile.profitCents).toBe(0);
  });
  it('13: partial return of a multi-line sale — exact cents', () => {
    const sale = mkSale({
      items: [
        mkItem({ id: 'li-a', name: 'Case', price: 3000, qty: 1, cost: 1000 }),
        mkItem({ id: 'li-b', name: 'Charger', price: 2000, qty: 1, cost: 800 }),
      ],
      subtotal: 5000, total: 5000,
    });
    const ret = mkReturn({
      originalSaleId: sale.id, originalInvoice: sale.invoiceNumber,
      items: [{ id: 'li-b', name: 'Charger', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, taxCents: 0, totalCents: 2000,
    });
    const profile = computeCustomerMoneyProfile(profileInput({ sales: [sale], customerReturns: [ret] }));
    expect(profile.totalCollectedCents).toBe(5000);
    expect(profile.returnsCents).toBe(2000);
    expect(profile.netAfterReturnsCents).toBe(3000);
    // exact line reversal: profit = (3000−1000) + (2000−800) − (2000−800)
    expect(profile.profitCents).toBe(2000);
  });
  it('14: refund-only period → negative net preserved (never clamped)', () => {
    const sale = jennyPayment(5); // May sale
    const ret = mkReturn({
      originalSaleId: sale.id, originalInvoice: sale.invoiceNumber,
      createdAt: '2026-06-20T15:00:00', // refunded in June
      items: [{ id: sale.items[0].id, name: 'AT&T - 8054523932', qty: 1, priceCents: 6500, subtotalCents: 6500, taxCents: 399, totalCents: 6899 }] as CustomerReturn['items'],
      subtotalCents: 6500, taxCents: 399, totalCents: 6899,
    });
    const profile = computeCustomerMoneyProfile(profileInput({
      sales: [sale], customerReturns: [ret],
      periodRange: normalizeLocalDayRange('2026-06-01', '2026-06-30'),
    }));
    expect(profile.totalCollectedCents).toBe(0);
    expect(profile.netAfterReturnsCents).toBe(-6899); // negative preserved, never clamped
    // Cross-period reversal without in-period cost data reverses at the
    // canonical estimate policy — profit never goes POSITIVE here.
    expect(profile.profitCents).toBeLessThanOrEqual(0);
  });
});

describe('I2B-0.1 tests 17/18 — financial privacy', () => {
  const privacyOn = { [FINANCIAL_PRIVACY_SETTING_KEY]: true };
  it('17: an unauthorized employee cannot view profit/margin/cost surfaces', () => {
    expect(canViewOwnerFinancials(privacyOn, false)).toBe(false);
  });
  it('18: the owner (or admin mode) can view them', () => {
    expect(canViewOwnerFinancials(privacyOn, true)).toBe(true);
    expect(canViewOwnerFinancials({}, false)).toBe(true); // setting off → visible (existing default)
  });
});

describe('I2B-0.1 tests 19-23 — perSaleEconomics hardening (no-ID / dup-ID / same-name)', () => {
  const TODAY = normalizeLocalDayRange('2026-06-01', '2026-06-30');
  const canonicalOf = (sales: Sale[]) => computeReportMoneyStats({
    sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [],
    customerReturns: [], vendorReturns: [], settings: SETTINGS as never,
    periodRange: TODAY, labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
  });
  it('19: a sale item WITHOUT item.id contributes to costCents', () => {
    const sale = mkSale({
      items: [{ ...mkItem({ name: 'Legacy Case', price: 3000, qty: 1, cost: 1200 }), id: undefined } as unknown as SaleItem],
      subtotal: 3000, total: 3000,
    });
    const stats = canonicalOf([sale]);
    expect(stats.perSaleEconomics[sale.id].costCents).toBe(1200);
    expect(stats.perSaleEconomics[sale.id].lines.length).toBe(1);
  });
  it('20: TWO no-ID items both contribute', () => {
    const sale = mkSale({
      items: [
        { ...mkItem({ name: 'Legacy A', price: 3000, qty: 1, cost: 1200 }), id: undefined },
        { ...mkItem({ name: 'Legacy B', price: 2000, qty: 1, cost: 700 }), id: undefined },
      ] as unknown as SaleItem[],
      subtotal: 5000, total: 5000,
    });
    const stats = canonicalOf([sale]);
    expect(stats.perSaleEconomics[sale.id].costCents).toBe(1900);
    expect(stats.perSaleEconomics[sale.id].lines.length).toBe(2);
  });
  it('21: duplicate item IDs do not overwrite economic totals', () => {
    const sale = mkSale({
      items: [
        mkItem({ id: 'dup-1', name: 'Case A', price: 3000, qty: 1, cost: 1200 }),
        mkItem({ id: 'dup-1', name: 'Case B', price: 2000, qty: 1, cost: 700 }),
      ],
      subtotal: 5000, total: 5000,
    });
    const stats = canonicalOf([sale]);
    expect(stats.perSaleEconomics[sale.id].costCents).toBe(1900); // NOT 700
    expect(stats.perSaleEconomics[sale.id].lines.length).toBe(2);
  });
  it('22: two same-name lines both stay represented', () => {
    const sale = mkSale({
      items: [
        mkItem({ name: 'Screen Protector', price: 1500, qty: 1, cost: 500 }),
        mkItem({ name: 'Screen Protector', price: 1500, qty: 1, cost: 500 }),
      ],
      subtotal: 3000, total: 3000,
    });
    const stats = canonicalOf([sale]);
    expect(stats.perSaleEconomics[sale.id].costCents).toBe(1000);
    expect(stats.perSaleEconomics[sale.id].lines.filter((l) => l.name === 'Screen Protector').length).toBe(2);
  });
  it('23: pseudo-item behavior unchanged (revenue-only, zero cost, profit excluded)', () => {
    const pseudoName = 'Layaway Deposit — iPhone';
    expect(isPseudoItem({ name: pseudoName } as SaleItem)).toBe(true);
    const sale = mkSale({
      items: [mkItem({ name: pseudoName, price: 5000, qty: 1 })],
      subtotal: 5000, total: 5000,
    });
    const stats = canonicalOf([sale]);
    expect(stats.perSaleEconomics[sale.id].costCents).toBe(0);
    expect(stats.perSaleEconomics[sale.id].itemProfitCents).toBe(0);
    expect(stats.perSaleEconomics[sale.id].lines.length).toBe(1);
    expect(stats.totalProfitCents).toBe(0);
  });
});

describe('I2B-0.1 tests 24/25/32 — refund self-reversal, exchange, store-wide totals (parity assertions)', () => {
  it('24: orphan refunded original still self-reverses exactly (P3 unchanged)', () => {
    const sales = [...jennySales(), mkSale({
      status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'orph-1', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000, createdAt: '2026-06-11T12:00:00',
    })];
    const profile = computeCustomerMoneyProfile(profileInput({ sales }));
    expect(profile.totalCollectedCents).toBe(48293 + 5000);  // gross keeps the original
    expect(profile.returnsCents).toBe(5000);                 // reversed exactly once
    expect(profile.netAfterReturnsCents).toBe(48293);
    expect(profile.profitCents).toBe(4550);                  // orphan's profit fully reversed
    const inv = checkReportMoneyInvariants(profile.canonical);
    expect(inv.ok).toBe(true);
  });
  it('25: exchange stays correct (I1.2 example through the customer profile)', () => {
    const original = mkSale({
      id: 'ex-1', createdAt: '2026-06-05T12:00:00',
      items: [mkItem({ id: 'li-x', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-1', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-x', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
      ...({ exchangeSaleId: 'repl-1' } as Partial<CustomerReturn>),
    });
    const replacement = mkSale({
      id: 'repl-1', createdAt: '2026-06-20T16:00:00',
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: 3000, total: 3000,
    });
    const profile = computeCustomerMoneyProfile(profileInput({
      sales: [original, replacement], customerReturns: [exchangeReturn],
    }));
    // I1.2 required example: net $80, COGS $30, profit $50.
    expect(profile.netAfterReturnsCents).toBe(8000);
    expect(profile.canonical.totalCostCents).toBe(3000);
    expect(profile.profitCents).toBe(5000);
    expect(checkReportMoneyInvariants(profile.canonical).ok).toBe(true);
  });
  it('32: store-wide Reports totals — the exposure changes nothing (gross/net/cost/profit/tax/returns identities hold)', () => {
    const sales = [
      jennyPayment(6),
      mkSale({
        items: [
          { ...mkItem({ name: 'Legacy NoId', price: 3000, qty: 1, cost: 1200 }), id: undefined },
          mkItem({ id: 'dup-9', name: 'A', price: 1000, qty: 1, cost: 300 }),
          mkItem({ id: 'dup-9', name: 'B', price: 1000, qty: 1, cost: 300 }),
        ] as unknown as SaleItem[],
        subtotal: 5000, total: 5000, createdAt: '2026-06-06T10:00:00',
      }),
    ];
    const stats = computeReportMoneyStats({
      sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [],
      customerReturns: [], vendorReturns: [], settings: SETTINGS as never,
      periodRange: normalizeLocalDayRange('2026-06-01', '2026-06-30'),
      labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
    });
    const inv = checkReportMoneyInvariants(stats);
    expect(inv).toMatchObject({ netSalesOk: true, netTaxOk: true, taxSplitOk: true, exchangeCreditOk: true, profitOk: true, netBeforeTaxOk: true, ok: true });
    expect(stats.grossSalesCents).toBe(6899 + 5000);
    expect(stats.netSalesCents).toBe(stats.grossSalesCents - stats.returnAndRefundAdjustmentsCents);
    // Σ exposed per-sale costs === store-wide COGS for this fixture
    const exposedCost = Object.values(stats.perSaleEconomics).reduce((s, e) => s + e.costCents, 0);
    expect(exposedCost).toBe(stats.totalCostCents);
  });
});

describe('I2B-0.1 tests 26/27 — scope + identity', () => {
  it('26: profiles are computed from the (pre-scoped) input arrays only', () => {
    const inStore = jennyPayment(3);
    const otherStoreSale = jennyPayment(4); // would belong to Jenny, but NOT passed (scoped out upstream)
    const scoped = computeCustomerMoneyProfile(profileInput({ sales: [inStore] }));
    const unscoped = computeCustomerMoneyProfile(profileInput({ sales: [inStore, otherStoreSale] }));
    expect(scoped.totalCollectedCents).toBe(6899);
    expect(unscoped.totalCollectedCents).toBe(13798);
  });
  it('27: two customers with the SAME NAME stay separate (batch + single)', () => {
    const jenny2: Customer = { id: 'cust-jenny-2', name: 'JENNY MIRANDA', phone: '8059998888' } as unknown as Customer;
    const s1 = jennyPayment(2);
    const s2 = mkSale({ customerId: 'cust-jenny-2', customerPhone: '8059998888', items: [mkItem({ name: 'Case', price: 1000, cost: 400 })], subtotal: 1000, total: 1000 });
    const batch = computeCustomerMoneyProfiles([JENNY, jenny2], batchInput({ sales: [s1, s2] }));
    expect(batch.get('cust-jenny')!.totalCollectedCents).toBe(6899);
    expect(batch.get('cust-jenny-2')!.totalCollectedCents).toBe(1000);
  });
});

describe('I2B-0.1 tests 28/29 — cache invalidation', () => {
  it('28: a store switch (new array references) invalidates the cache', () => {
    const cache = createCustomerProfilesCache();
    const custs = [JENNY];
    const storeA = batchInput({ sales: [jennyPayment(1)] });
    const first = cache.get(custs, storeA);
    expect(cache.get(custs, storeA)).toBe(first); // stable while refs unchanged
    const storeB = batchInput({ sales: [jennyPayment(2), jennyPayment(3)] });
    const second = cache.get(custs, storeB);
    expect(second).not.toBe(first);
    expect(second.get('cust-jenny')!.totalCollectedCents).toBe(13798);
  });
  it('29: a transaction update with EQUAL array length still invalidates (identity, not length)', () => {
    const cache = createCustomerProfilesCache();
    const v1 = [jennyPayment(1)];
    const inputV1 = batchInput({ sales: v1 });
    const first = cache.get([JENNY], inputV1);
    expect(first.get('cust-jenny')!.totalCollectedCents).toBe(6899);
    // Same length (1), edited amount, NEW array reference — must recompute.
    const v2 = [{ ...v1[0], total: 7899, subtotal: 7500 } as Sale];
    const second = cache.get([JENNY], batchInput({ sales: v2 }));
    expect(second).not.toBe(first);
    expect(second.get('cust-jenny')!.totalCollectedCents).toBe(7899);
  });
});

describe('I2B-0.1 tests 30/31 — hygiene', () => {
  it('30: no NaN / Infinity in any numeric profile field (incl. empty history)', () => {
    for (const profile of [
      computeCustomerMoneyProfile(profileInput({})),
      computeCustomerMoneyProfile(profileInput({ sales: jennySales() })),
    ]) {
      for (const [k, v] of Object.entries(profile)) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), `field ${k}`).toBe(true);
        }
      }
    }
  });
  it('31: inputs are never mutated; output is deterministic', () => {
    const sales = jennySales();
    const snapshot = JSON.stringify(sales);
    const input = profileInput({ sales });
    const a = computeCustomerMoneyProfile(input);
    const b = computeCustomerMoneyProfile(input);
    expect(JSON.stringify(sales)).toBe(snapshot);
    expect(moneyFields(a)).toEqual(moneyFields(b));
    expect(a.invoiceEconomics).toEqual(b.invoiceEconomics);
  });
});

describe('I2B-0.1 Part G — owner diagnostic trace (pure, read-only)', () => {
  it('produces the invoice-level trace with rate provenance and mutates nothing', () => {
    const sales = [...jennySales().slice(0, 6), jennyPayment(7, { commissionRate: 0.07 } as Partial<SaleItem>)];
    const snapshot = JSON.stringify(sales);
    const trace = traceCustomerInvoiceEconomics(profileInput({ sales }));
    expect(JSON.stringify(sales)).toBe(snapshot);
    expect(trace.customerId).toBe('cust-jenny');
    expect(trace.invoices.length).toBe(7);
    const configured = trace.invoices.filter((r) => r.rateSource === 'configured_carrier');
    const stamped = trace.invoices.filter((r) => r.rateSource === 'stamped');
    expect(configured.length).toBe(6);
    expect(stamped.length).toBe(1);
    expect(stamped[0].commissionRate).toBe(0.07);
    expect(stamped[0].profitCents).toBe(455);
    expect(configured[0].commissionRate).toBe(0.10);
    expect(configured[0].carrier).toBe('AT&T');
    expect(trace.summary.totalCollectedCents).toBe(48293);
    expect(trace.summary.profitCents).toBe(6 * 650 + 455);
  });
  it('flags the hardcoded 7% tail as a warning (never presented as configured)', () => {
    const trace = traceCustomerInvoiceEconomics(profileInput({
      sales: [jennyPayment(1, { carrier: 'Cricket' })],
      settings: {}, // nothing configured at all
    }));
    expect(trace.invoices[0].rateSource).toBe('estimated_fallback');
    expect(trace.invoices[0].warnings).toContain('no_configured_commission_rate_hardcoded_7pct_tail');
    expect(trace.invoices[0].economicBasis).toBe('estimated');
  });
});
