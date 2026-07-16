// ============================================================
// CELLHUB-INTELLIGENCE-I1 — characterization tests for the canonical
// Reports money service.
//
// These tests LOCK the behavior that lived inline in ReportsModule.tsx at
// the moment of extraction. They are a CHARACTERIZATION, not a policy
// statement: where existing behavior is suspicious it is preserved and
// explicitly marked "PRESERVED (suspicious)" — candidates for a future
// financial-correction round, never silently changed here.
//
// All expected values are exact integer cents, hand-derived from the
// extracted rules. Real store types only — no simplified parallel shapes.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Sale, SaleItem, Repair, Unlock, Layaway, SpecialOrder, InventoryItem, CustomerReturn, StoreSettings } from '@/store/types';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import {
  computeReportMoney,
  computeReportMoneyStats,
  deriveReportCollections,
  checkReportMoneyInvariants,
  isCountableSale,
  isPseudoItem,
} from './computeReportMoneyStats';
import type { ReportMoneyStatsInput, ReportMoneyStats } from './computeReportMoneyStats';

/** I1.1/I1.3: every fixture must satisfy the canonical reconciliation relations. */
function expectInvariants(stats: ReportMoneyStats) {
  expect(checkReportMoneyInvariants(stats)).toEqual({
    netSalesOk: true, netTaxOk: true, taxSplitOk: true,
    exchangeCreditOk: true, profitOk: true, netBeforeTaxOk: true, ok: true,
  });
}

// ── Fixture builders (real types; only money-relevant fields vary) ──

const DAY = '2026-07-10';
const AT = (time: string) => `${DAY}T${time}`;
const RANGE = normalizeLocalDayRange(DAY, DAY);
const LABELS = { noProvider: 'No provider', noCarrier: 'No carrier', unknownEmployee: 'Unknown' };
const SETTINGS = { defaultCommissionRate: 0.08, carrierCommissions: {} } as unknown as StoreSettings;

let idSeq = 0;
function mkItem(over: Partial<SaleItem>): SaleItem {
  return {
    id: `it-${++idSeq}`,
    name: 'Item',
    category: 'accessory' as SaleItem['category'],
    price: 0,
    qty: 1,
    cbeEligible: false,
    taxable: true,
    ...over,
  } as SaleItem;
}

function mkSale(over: Partial<Sale>): Sale {
  return {
    id: `s-${++idSeq}`,
    invoiceNumber: `INV-${idSeq}`,
    items: [],
    subtotal: 0,
    taxAmount: 0,
    cbeTotal: 0,
    total: 0,
    paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'],
    createdAt: AT('12:00:00'),
    ...over,
  } as Sale;
}

function input(over: Partial<ReportMoneyStatsInput>): ReportMoneyStatsInput {
  return {
    sales: [], repairs: [], unlocks: [], specialOrders: [], layaways: [],
    inventory: [], customerReturns: [], vendorReturns: [],
    settings: SETTINGS, periodRange: RANGE, labels: LABELS,
    ...over,
  };
}

function catRow(stats: ReturnType<typeof computeReportMoneyStats>, name: string) {
  return stats.categoriesByRevenue.find((c) => c.name === name);
}

// ── Fixture 1: standard completed taxable product sale ──────

describe('F1 — standard taxable product sale', () => {
  const sale = mkSale({
    items: [mkItem({ name: 'Case', category: 'accessory' as SaleItem['category'], price: 5000, qty: 2, cost: 2000 })],
    subtotal: 10000, salesTax: 875, total: 10875, paymentMethod: 'cash' as Sale['paymentMethod'],
    employeeName: 'Ana',
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));

  it('revenue / tax / profit / tender in exact cents', () => {
    expect(stats.grossRevenueCents).toBe(10875);
    expect(stats.netRevenueCents).toBe(10875);
    expect(stats.subtotalBeforeTaxCents).toBe(10000);
    expect(stats.productSalesTaxCents).toBe(875);
    expect(stats.taxCollectedCents).toBe(875);
    expect(stats.totalCostCents).toBe(4000);
    expect(stats.totalProfitCents).toBe(6000);
    expect(stats.profitMargin).toBe(60);
    expect(stats.cashCents).toBe(10875);
    expect(stats.txCount).toBe(1);
    expect(stats.cleanSalesCount).toBe(1);
  });
  it('category + top item + employee rows', () => {
    expect(catRow(stats, 'accessory')).toMatchObject({ quantity: 2, revenueCents: 10000, costCents: 4000, profitCents: 6000, marginPct: 60 });
    expect(stats.topItems[0]).toEqual({ name: 'Case', quantity: 2, revenueCents: 10000 });
    expect(stats.topEmployees[0]).toEqual({ name: 'Ana', transactions: 1, revenueCents: 10875 });
  });
});

// ── Fixture 2: tax-exempt repair sale (in-POS, linked repair) ──

describe('F2 — tax-exempt in-POS repair (parts-only COGS)', () => {
  const repair: Repair = { id: 'R1', parts: [{ cost: 1500, qty: 1 }], status: 'in_progress', createdAt: AT('09:00:00') } as unknown as Repair;
  const sale = mkSale({
    items: [mkItem({ name: 'Screen repair', repairId: 'R1', price: 8000, qty: 1, taxable: false })],
    subtotal: 8000, salesTax: 0, total: 8000,
  });
  const stats = computeReportMoneyStats(input({ sales: [sale], repairs: [repair] }));

  it('labor is margin, only PARTS are cost (R-REPORTS-REPAIR-MARGIN-FIX-V1)', () => {
    expect(stats.taxCollectedCents).toBe(0);
    expect(catRow(stats, 'Repairs')).toMatchObject({ revenueCents: 8000, costCents: 1500, profitCents: 6500 });
    expect(stats.totalProfitCents).toBe(6500);
  });
  it('a POS-paid repair is NOT double-counted as standalone (even when completed)', () => {
    const done = { ...repair, status: 'completed', balance: 0, total: 8000 } as unknown as Repair;
    const s2 = computeReportMoneyStats(input({ sales: [sale], repairs: [done] }));
    expect(catRow(s2, 'Repairs')).toMatchObject({ quantity: 1, revenueCents: 8000 });
  });
});

// ── Fixture 3: mixed product + service sale ─────────────────

describe('F3 — mixed product and service sale', () => {
  const sale = mkSale({
    items: [
      mkItem({ name: 'Charger', category: 'accessory' as SaleItem['category'], price: 3000, qty: 1, cost: 1000 }),
      mkItem({ name: 'Data transfer', category: 'service' as SaleItem['category'], price: 2000, qty: 1, cost: 500 }),
    ],
    subtotal: 5000, salesTax: 263, total: 5263,
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));
  it('buckets split; totals are the sum of both lines', () => {
    expect(catRow(stats, 'accessory')).toMatchObject({ revenueCents: 3000, costCents: 1000, profitCents: 2000 });
    expect(catRow(stats, 'Services')).toMatchObject({ revenueCents: 2000, costCents: 500, profitCents: 1500 });
    expect(stats.totalProfitCents).toBe(3500);
  });
});

// ── Fixtures 4+5+12: carrier payment w/ provider classification + commission ──

describe('F4/F5/F12 — phone payment economics + provider bucket', () => {
  it('stamped commissionRate wins: cost=round(rev*(1-rate))', () => {
    const sale = mkSale({
      items: [mkItem({ name: 'H2O - 8055551234', category: 'phone_payment' as SaleItem['category'], price: 5000, qty: 1, carrier: 'H2O', phoneNumber: '8055551234', ...( { commissionRate: 0.10 } as Partial<SaleItem>) })],
      subtotal: 5000, utilityTax: 250, total: 5250,
    });
    const stats = computeReportMoneyStats(input({ sales: [sale] }));
    expect(catRow(stats, 'Phone Payments')).toMatchObject({ revenueCents: 5000, costCents: 4500, profitCents: 500 });
    expect(stats.utilityTaxCents).toBe(250);
    // Provider aggregation (canonical service): 1 payment, no activation.
    const providers = Object.values(stats.phonePaymentsByProvider);
    expect(providers.reduce((s, p) => s + p.totalCents, 0)).toBe(5000);
    expect(providers.reduce((s, p) => s + p.count, 0)).toBe(1);
    expect(Object.keys(stats.activationsByCarrier).length).toBe(0);
  });
  it('missing rate falls back to settings.defaultCommissionRate (0.08 → cost 92%)', () => {
    const sale = mkSale({
      items: [mkItem({ name: 'Cricket Bill Payment', category: 'phone_payment' as SaleItem['category'], price: 4000, qty: 1 })],
      subtotal: 4000, total: 4000,
    });
    const stats = computeReportMoneyStats(input({ sales: [sale] }));
    expect(catRow(stats, 'Phone Payments')).toMatchObject({ costCents: 3680, profitCents: 320 });
  });
});

// ── Fixture 6: activation (plan + SIM consolidate under Activations) ──

describe('F6 — activation flow', () => {
  const sale = mkSale({
    items: [
      mkItem({ name: 'Verizon Plan', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', isActivation: true, ...( { commissionRate: 0.10 } as Partial<SaleItem>) }),
      mkItem({ name: 'SIM card', category: 'sim' as SaleItem['category'], price: 1000, qty: 1, cost: 200 }),
    ],
    subtotal: 7000, total: 7000,
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));
  it('both lines bucket under Activations (never Phone Payments), economics untouched', () => {
    expect(catRow(stats, 'Phone Payments')).toBeUndefined();
    // plan: cost 5400/profit 600 (commission math kept) + SIM: cost 200/profit 800
    expect(catRow(stats, 'Activations')).toMatchObject({ quantity: 2, revenueCents: 7000, costCents: 5600, profitCents: 1400 });
  });
  it('activation events land in activationsByCarrier, not the provider table', () => {
    expect(Object.values(stats.phonePaymentsByProvider).reduce((s, p) => s + p.count, 0)).toBe(0);
    expect(Object.keys(stats.activationsByCarrier).length).toBeGreaterThan(0);
  });
});

// ── Fixtures 7+10: full refund (R11 shape) + legacy-dollar return record ──

describe('F7/F10 — I1.1: same-period FULL refund nets to ZERO (required test 1/4/16)', () => {
  const returnedItems = [{ id: 'li-1', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }];
  const original = mkSale({
    id: 'orig-1',
    items: [mkItem({ id: 'li-1', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
    subtotal: 5000, salesTax: 450, total: 5450, status: 'refunded' as Sale['status'],
  });
  const ret: CustomerReturn = {
    id: 'ret-1', returnNumber: 'RTN-1', originalInvoice: original.invoiceNumber,
    originalSaleId: 'orig-1', customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: AT('15:00:00'), reason: 'defective', resolution: 'cash', notes: '',
    items: returnedItems as CustomerReturn['items'],
    subtotalCents: 5000, taxCents: 450, totalCents: 5450,
  } as CustomerReturn;
  const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));

  it('gross $54.50 − refund $54.50 = net $0 (never −$54.50; refunded original STAYS in gross)', () => {
    expect(stats.grossSalesCents).toBe(5450);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(5450);
    expect(stats.netSalesCents).toBe(0);
    expect(stats.refundedCount).toBe(1);
    expect(stats.txCount).toBe(1);
    expectInvariants(stats);
  });
  it('refunded-status + CustomerReturn = ONE subtraction, not two (required test 4)', () => {
    // If both representations subtracted, net would be −5450.
    expect(stats.netSalesCents).toBe(0);
  });
  it('net tax is ZERO for a same-period full refund — unclamped relation (required test 16)', () => {
    expect(stats.grossTaxCollectedCents).toBe(450);
    expect(stats.taxRefundedCents).toBe(450);
    expect(stats.netTaxCents).toBe(0);
    expect(stats.taxCollectedCents).toBe(0);
  });
  it('EXACT profit reversal from the original item cost (required test 9): profit nets to 0', () => {
    // item profit 3000; reversal = returned 5000 − exact cost 2000 = 3000.
    expect(stats.returnedCostReversalCents).toBe(2000);
    expect(stats.returnedProfitReversalCents).toBe(3000);
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.totalCostCents).toBe(0); // returned goods back to stock
  });
  it('legacy DOLLAR return records normalize via Math.round(*100)', () => {
    const legacy = { ...ret, id: 'ret-2', originalSaleId: null, subtotalCents: undefined, taxCents: undefined, totalCents: undefined, subtotal: 12.34, taxRefunded: 1.08, total: 13.42 } as unknown as CustomerReturn;
    const c = deriveReportCollections(input({ customerReturns: [legacy] }));
    expect(c.allReturns[0]).toMatchObject({ subtotalCents: 1234, taxCents: 108, totalCents: 1342 });
  });
});

// ── Fixture 8: partially returned sale ──────────────────────

describe('F8 — partial return (original stays countable)', () => {
  const sale = mkSale({
    id: 'orig-2',
    items: [mkItem({ name: 'Case', price: 5000, qty: 2, cost: 2000 })],
    subtotal: 10000, salesTax: 875, total: 10875,
  });
  const ret: CustomerReturn = {
    id: 'ret-3', returnNumber: 'RTN-3', originalInvoice: sale.invoiceNumber,
    originalSaleId: 'orig-2', customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: AT('16:00:00'), reason: 'changed_mind', resolution: 'cash', notes: '', items: [],
    subtotalCents: 2000, taxCents: 175, totalCents: 2175,
  } as CustomerReturn;
  const stats = computeReportMoneyStats(input({ sales: [sale], customerReturns: [ret] }));

  it('gross keeps the original; net subtracts the return; tax nets the refunded tax (required test 2)', () => {
    expect(stats.grossSalesCents).toBe(10875);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(2175);
    expect(stats.netSalesCents).toBe(8700);
    expect(stats.netTaxCents).toBe(700); // 875 − 175
    expectInvariants(stats);
  });
  it('I1.1: itemless legacy return falls back to average margin and is FLAGGED estimated (required test 10 fallback tier 4)', () => {
    // raw profit 6000; estimate = round((6000/10000) * 2000) = 1200 — same
    // value the old silent adjustment produced, now explicitly marked.
    expect(stats.totalProfitCents).toBe(4800);
    expect(stats.profitAdjustmentEstimated).toBe(true);
  });
});

// ── Fixture 9: voided sale ──────────────────────────────────

describe('F9 — voided sale is excluded everywhere', () => {
  const voided = mkSale({
    items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })],
    subtotal: 5000, salesTax: 450, total: 5450, status: 'voided' as Sale['status'],
  });
  const stats = computeReportMoneyStats(input({ sales: [voided] }));
  it('zero revenue/tax/profit/tender; counted only in voidedCount', () => {
    expect(isCountableSale(voided)).toBe(false);
    expect(stats.grossRevenueCents).toBe(0);
    expect(stats.taxCollectedCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.cashCents).toBe(0);
    expect(stats.voidedCount).toBe(1);
    expect(stats.txCount).toBe(0);
    expect(stats.categoriesByRevenue.length).toBe(0);
  });
});

// ── Fixture 11: fees (CBE, screen fee, CC fee) ──────────────

describe('F11 — fees', () => {
  const sale = mkSale({
    items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })],
    subtotal: 5000, salesTax: 450, cbeTotal: 200, screenFeeTotal: 300, creditCardFee: 250,
    total: 6200, paymentMethod: 'card' as Sale['paymentMethod'],
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));
  it('CBE + screen fee accumulate; CC fee becomes a 100%-margin category row', () => {
    expect(stats.cbeCollectedCents).toBe(200);
    expect(stats.screenFeeCents).toBe(300);
    expect(catRow(stats, 'CC Fees')).toMatchObject({ quantity: 1, revenueCents: 250, costCents: 0, profitCents: 250 });
    expect(stats.totalProfitCents).toBe(3250); // 3000 product + 250 cc fee
    expect(stats.cardCents).toBe(6200);
  });
  it('Z-tape recon: fees separate from tax; operational = gross − tax − fees', () => {
    expect(stats.recon.taxCollectedCents).toBe(450);
    expect(stats.recon.feeCollectedCents).toBe(500);
    expect(stats.recon.grossCollectedCents).toBe(6200);
    expect(stats.recon.operationalRevenueCents).toBe(5250);
  });
});

// ── Fixture 13: discount ────────────────────────────────────

describe('F13 — discount derived from subtotal − subtotalAfterDiscount', () => {
  const sale = mkSale({
    items: [mkItem({ name: 'Case', price: 4500, qty: 2, cost: 2000 })],
    subtotal: 10000, subtotalAfterDiscount: 9000, salesTax: 788, total: 9788,
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));
  it('subtotalBeforeTax nets the discount (margin denominator)', () => {
    expect(stats.subtotalBeforeTaxCents).toBe(9000);
  });
});

// ── Fixtures 14+15: zero-cost item + legacy missing cost (inventory fallback) ──

describe('F14/F15 — zero cost + inventory cost fallback', () => {
  it('I1.1: EXPLICIT zero cost stays ZERO — never replaced by the inventory fallback (required test 11)', () => {
    const sale = mkSale({ items: [mkItem({ name: 'Freebie', price: 1000, qty: 1, cost: 0 })], subtotal: 1000, total: 1000 });
    const inv = [{ id: 'i1', name: 'Freebie', cost: 700 } as unknown as InventoryItem];
    const stats = computeReportMoneyStats(input({ sales: [sale], inventory: inv }));
    expect(catRow(stats, 'accessory')).toMatchObject({ costCents: 0, profitCents: 1000 });
  });
  it('genuinely MISSING cost uses the inventory name-match fallback (required test 10)', () => {
    const legacyItem = mkItem({ name: 'Freebie', price: 1000, qty: 1 });
    delete (legacyItem as Partial<SaleItem>).cost;
    const sale = mkSale({ items: [legacyItem], subtotal: 1000, total: 1000 });
    const inv = [{ id: 'i1', name: 'Freebie', cost: 700 } as unknown as InventoryItem];
    const stats = computeReportMoneyStats(input({ sales: [sale], inventory: inv }));
    expect(catRow(stats, 'accessory')).toMatchObject({ costCents: 700, profitCents: 300 });
  });
  it('missing legacy cost field + no inventory match → cost 0, profit = revenue', () => {
    const it14 = mkItem({ name: 'Mystery', price: 1500, qty: 1 });
    delete (it14 as Partial<SaleItem>).cost;
    const sale = mkSale({ items: [it14], subtotal: 1500, total: 1500 });
    const stats = computeReportMoneyStats(input({ sales: [sale] }));
    expect(catRow(stats, 'accessory')).toMatchObject({ costCents: 0, profitCents: 1500 });
  });
});

// ── Fixture 16: historical/legacy sale shape ────────────────

describe('F16 — legacy sale shape still supported', () => {
  const legacyItem = mkItem({ name: 'Legacy topup', price: 2000 });
  delete (legacyItem as Partial<SaleItem>).qty;
  (legacyItem as unknown as { quantity?: number }).quantity = 2;          // legacy qty field
  (legacyItem as unknown as { type?: string }).type = 'topup';            // legacy type field
  (legacyItem as unknown as { category?: string }).category = '';
  const sale = mkSale({
    items: [legacyItem],
    subtotal: 4000, taxAmount: 350, total: 4350,                          // legacy aggregate tax ONLY
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));
  it('legacy taxAmount routes to its OWN bucket (never pollutes salesTax)', () => {
    expect(stats.productSalesTaxCents).toBe(0);
    expect(stats.legacyTaxAmountCents).toBe(350);
    expect(stats.taxCollectedCents).toBe(350);
  });
  it('legacy type/quantity fields classify + count (Top-Ups at 90% cost)', () => {
    expect(catRow(stats, 'Top-Ups')).toMatchObject({ quantity: 2, revenueCents: 4000, costCents: 3600, profitCents: 400 });
  });
});

// ── Fixtures 17+18: employees + payment methods ─────────────

describe('F17/F18 — multiple employees + tenders', () => {
  const sales = [
    mkSale({ items: [mkItem({ name: 'A', price: 3000, qty: 1, cost: 0 })], subtotal: 3000, total: 3000, employeeName: 'Ana', paymentMethod: 'cash' as Sale['paymentMethod'] }),
    mkSale({ items: [mkItem({ name: 'B', price: 7000, qty: 1, cost: 0 })], subtotal: 7000, total: 7000, employeeName: 'Beto', paymentMethod: 'card' as Sale['paymentMethod'] }),
    mkSale({
      items: [mkItem({ name: 'C', price: 4000, qty: 1, cost: 0 })], subtotal: 4000, total: 4000,
      paymentMethod: 'split' as Sale['paymentMethod'],
      splitPayment: { cash: 1000, card: 2500, storeCredit: 500 } as Sale['splitPayment'],
    }),
    mkSale({ items: [mkItem({ name: 'D', price: 2000, qty: 1, cost: 0 })], subtotal: 2000, total: 2000, paymentMethod: 'store_credit' as Sale['paymentMethod'] }),
  ];
  const stats = computeReportMoneyStats(input({ sales }));
  it('tender buckets: split decomposes; store_credit accumulates', () => {
    expect(stats.cashCents).toBe(4000);        // 3000 + split 1000
    expect(stats.cardCents).toBe(9500);        // 7000 + split 2500
    expect(stats.storeCreditCents).toBe(2500); // split 500 + 2000
  });
  it('employee ranking by revenue; missing name → injected label', () => {
    expect(stats.topEmployees[0]).toMatchObject({ name: 'Beto', revenueCents: 7000 });
    expect(stats.topEmployees.find((e) => e.name === 'Unknown')?.transactions).toBe(2);
  });
});

// ── Fixture 19: multiple carriers/providers ─────────────────

describe('F19 — multiple carriers and providers', () => {
  const sale = mkSale({
    items: [
      mkItem({ name: 'H2O - 111', category: 'phone_payment' as SaleItem['category'], price: 3000, qty: 1, carrier: 'H2O', ...( { commissionRate: 0.10 } as Partial<SaleItem>) }),
      mkItem({ name: 'Verizon - 222', category: 'phone_payment' as SaleItem['category'], price: 4000, qty: 1, carrier: 'Verizon', ...( { commissionRate: 0.10 } as Partial<SaleItem>) }),
    ],
    subtotal: 7000, total: 7000,
  });
  const stats = computeReportMoneyStats(input({ sales: [sale] }));
  it('provider totals reconcile to the Phone Payments category exactly', () => {
    const providers = Object.values(stats.phonePaymentsByProvider);
    expect(providers.reduce((s, p) => s + p.totalCents, 0)).toBe(7000);
    expect(catRow(stats, 'Phone Payments')?.revenueCents).toBe(7000);
    expect(providers.reduce((s, p) => s + p.count, 0)).toBe(2);
  });
});

// ── Fixture 20: empty dataset ───────────────────────────────

describe('F20 — empty dataset', () => {
  const stats = computeReportMoneyStats(input({}));
  it('all zeros, empty tables, margin 0 (no NaN/undefined)', () => {
    expect(stats.grossRevenueCents).toBe(0);
    expect(stats.netRevenueCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.taxCollectedCents).toBe(0);
    expect(stats.profitMargin).toBe(0);
    expect(stats.categoriesByRevenue).toEqual([]);
    expect(stats.topItems).toEqual([]);
    expect(stats.topEmployees).toEqual([]);
    expect(stats.phonePaymentsByProvider).toEqual({});
    expect(stats.activationsByCarrier).toEqual({});
    expect(stats.txCount).toBe(0);
  });
});

// ── Standalone repairs/unlocks + vendor returns + pseudo items ──

describe('standalone entities + vendor returns + pseudo/layaway items', () => {
  it('I1.1: standalone completed repair contributes to GROSS/NET like unlocks (required test 12)', () => {
    const repair = {
      id: 'R9', status: 'completed', balance: 0, total: 12000,
      parts: [{ cost: 3000, qty: 1 }], laborCost: 2000, createdAt: AT('10:00:00'),
    } as unknown as Repair;
    const stats = computeReportMoneyStats(input({ repairs: [repair] }));
    expect(catRow(stats, 'Repairs')).toMatchObject({ quantity: 1, revenueCents: 12000, costCents: 5000, profitCents: 7000 });
    expect(stats.grossSalesCents).toBe(12000);
    expect(stats.netSalesCents).toBe(12000);
    expect(stats.subtotalBeforeTaxCents).toBe(12000);
    expect(stats.totalProfitCents).toBe(7000);
    expect(stats.completedRepairCount).toBe(1);
    expectInvariants(stats);
  });
  it('completed-but-UNPAID repair (balance > 0) is NOT counted; paid-but-not-completed neither', () => {
    const unpaid = { id: 'R10', status: 'completed', balance: 2500, total: 12000, parts: [], createdAt: AT('10:00:00') } as unknown as Repair;
    const notDone = { id: 'R11', status: 'in_progress', balance: 0, total: 9000, parts: [], createdAt: AT('10:05:00') } as unknown as Repair;
    const stats = computeReportMoneyStats(input({ repairs: [unpaid, notDone] }));
    expect(stats.grossSalesCents).toBe(0);
    expect(catRow(stats, 'Repairs')).toBeUndefined();
  });

  it('standalone completed unlock enters gross AND subtotalBeforeTax', () => {
    const unlock = { id: 'U9', status: 'completed', price: 4000, cost: 1500, createdAt: AT('10:30:00') } as unknown as Unlock;
    const stats = computeReportMoneyStats(input({ unlocks: [unlock] }));
    expect(catRow(stats, 'Unlocks')).toMatchObject({ revenueCents: 4000, costCents: 1500, profitCents: 2500 });
    expect(stats.grossRevenueCents).toBe(4000);
    expect(stats.subtotalBeforeTaxCents).toBe(4000);
  });

  it('vendor returns reduce COGS, floored at 0', () => {
    const sale = mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })], subtotal: 5000, total: 5000 });
    const vr = { id: 'VR1', createdAt: AT('11:00:00'), totalValueCents: 500 };
    const stats = computeReportMoneyStats(input({ sales: [sale], vendorReturns: [vr] }));
    expect(stats.totalCostCents).toBe(1500); // 2000 − 500
    const vrBig = { id: 'VR2', createdAt: AT('11:00:00'), totalValueCents: 99999 };
    const s2 = computeReportMoneyStats(input({ sales: [sale], vendorReturns: [vrBig] }));
    expect(s2.totalCostCents).toBe(0);       // floored
  });

  it('layaway pseudo-item inherits proportional cost and buckets under Layaway', () => {
    const layaway = {
      id: 'L1', totalPrice: 20000,
      items: [{ inventoryId: 'inv1', qty: 1 }],
    } as unknown as Layaway;
    const inv = [{ id: 'inv1', name: 'Phone', cost: 8000 } as unknown as InventoryItem];
    const pseudo = mkItem({ name: 'Layaway Deposit — Phone', price: 5000, qty: 1, layawayId: 'L1' });
    expect(isPseudoItem(pseudo)).toBe(true);
    const sale = mkSale({ items: [pseudo], subtotal: 5000, total: 5000 });
    const stats = computeReportMoneyStats(input({ sales: [sale], layaways: [layaway], inventory: inv }));
    // proportional = round(8000 * 5000/20000) = 2000
    expect(catRow(stats, 'Layaway')).toMatchObject({ revenueCents: 5000, costCents: 2000, profitCents: 3000 });
  });

  it('pseudo-item WITHOUT reliable link keeps revenue but is excluded from margin (null marginPct)', () => {
    const pseudo = mkItem({ name: 'Repair Deposit', price: 3000, qty: 1 });
    const sale = mkSale({ items: [pseudo], subtotal: 3000, total: 3000 });
    const stats = computeReportMoneyStats(input({ sales: [sale] }));
    const row = catRow(stats, 'accessory');
    expect(row).toMatchObject({ revenueCents: 3000, costCents: 0, profitCents: 0 });
    expect(row?.marginPct).toBeNull();
  });
});

// ── Special order override + edit-audit refund sale + date boundaries ──

describe('special orders, refund-audit sales, date boundaries', () => {
  it('SO-linked line: revenue snaps to SO.price; tax excess routes to salesTax bucket', () => {
    const so = { id: 'SO1', price: 10000, cost: 6000 } as unknown as SpecialOrder;
    const sale = mkSale({
      items: [mkItem({ name: 'SO pickup', specialOrderId: 'SO1', price: 10875, qty: 1 })],
      subtotal: 10875, total: 10875,
    });
    const stats = computeReportMoneyStats(input({ sales: [sale], specialOrders: [so] }));
    expect(catRow(stats, 'Special Orders')).toMatchObject({ revenueCents: 10000, costCents: 6000, profitCents: 4000 });
    expect(stats.productSalesTaxCents).toBe(875); // 10875 − 10000 extracted as embedded tax
  });

  it('I1.1: post-edit refund sale (REFUND-*, completed, negative) is a deduped ADJUSTMENT, never gross (required test 6-family)', () => {
    const good = mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 0 })], subtotal: 5000, salesTax: 450, total: 5450 });
    const refund = mkSale({
      invoiceNumber: 'REFUND-1',
      items: [mkItem({ name: 'Case', price: -2000, qty: 1, cost: 0 })],
      subtotal: -2000, salesTax: -175, total: -2175,
    });
    const stats = computeReportMoneyStats(input({ sales: [good, refund] }));
    expect(stats.grossSalesCents).toBe(5450);                    // refund row is NOT gross activity
    expect(stats.returnAndRefundAdjustmentsCents).toBe(2175);
    expect(stats.netSalesCents).toBe(3275);                      // 5450 − 2175
    expect(stats.grossTaxCollectedCents).toBe(450);
    expect(stats.taxRefundedCents).toBe(175);
    expect(stats.netTaxCents).toBe(275);
    expect(stats.cleanSalesCount).toBe(1);
    expect(stats.refundSalesCount).toBe(1);
    // Base (2175−175=2000) is pure margin reversal — no goods cost stamped.
    expect(stats.returnedProfitReversalCents).toBe(2000);
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expectInvariants(stats);
  });

  it('date boundaries: 23:59:59 included, next-day 00:00:00 excluded', () => {
    const inSale = mkSale({ items: [mkItem({ name: 'A', price: 100, qty: 1, cost: 0 })], subtotal: 100, total: 100, createdAt: AT('23:59:59') });
    const outSale = mkSale({ items: [mkItem({ name: 'B', price: 999, qty: 1, cost: 0 })], subtotal: 999, total: 999, createdAt: '2026-07-11T00:00:00' });
    const stats = computeReportMoneyStats(input({ sales: [inSale, outSale] }));
    expect(stats.grossRevenueCents).toBe(100);
    expect(stats.txCount).toBe(1);
  });

  it('I1.1 required 17: computeReportMoneyStats ≡ computeReportMoney().stats (single pipeline, no drift)', () => {
    const sale = mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })], subtotal: 5000, salesTax: 450, total: 5450 });
    const inp = input({ sales: [sale] });
    expect(computeReportMoneyStats(inp)).toEqual(computeReportMoney(inp).stats);
  });

  it('determinism: same input twice → identical output; inputs never mutated', () => {
    const item = mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 });
    const sale = mkSale({ items: [item], subtotal: 5000, salesTax: 450, total: 5450 });
    const frozenIn = input({ sales: [sale] });
    const snapshot = JSON.stringify(frozenIn.sales);
    const a = computeReportMoney(frozenIn);
    const b = computeReportMoney(frozenIn);
    expect(a.stats).toEqual(b.stats);
    expect(JSON.stringify(frozenIn.sales)).toBe(snapshot);
  });
});

// ══ I1.1 — refund reconciliation required scenarios ══════════

describe('I1.1 — cross-period refunds and dedup (required tests 3/5/6/7/8/15)', () => {
  const mkReturn = (over: Partial<CustomerReturn>): CustomerReturn => ({
    id: `ret-${++idSeq}`, returnNumber: `RTN-${idSeq}`, originalInvoice: '',
    originalSaleId: null, customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: AT('15:00:00'), reason: 'defective', resolution: 'cash', notes: '',
    items: [], subtotalCents: 0, taxCents: 0, totalCents: 0,
    ...over,
  } as CustomerReturn);

  it('3: CROSS-PERIOD refund → current period gross $0, adjustment $100, net −$100 (valid negative)', () => {
    const original = mkSale({
      id: 'old-1', createdAt: '2026-07-01T12:00:00', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-9', name: 'Case', price: 9174, qty: 1, cost: 4000 })],
      subtotal: 9174, salesTax: 826, total: 10000,
    });
    const ret = mkReturn({
      originalSaleId: 'old-1', originalInvoice: original.invoiceNumber,
      createdAt: AT('15:00:00'), // refund happens in the CURRENT period
      items: [{ id: 'li-9', name: 'Case', qty: 1, priceCents: 9174, subtotalCents: 9174, taxCents: 826, totalCents: 10000 }] as CustomerReturn['items'],
      subtotalCents: 9174, taxCents: 826, totalCents: 10000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));
    expect(stats.grossSalesCents).toBe(0);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(10000);
    expect(stats.netSalesCents).toBe(-10000);
    // 15: refund-only period → NEGATIVE net tax, never clamped.
    expect(stats.grossTaxCollectedCents).toBe(0);
    expect(stats.taxRefundedCents).toBe(826);
    expect(stats.netTaxCents).toBe(-826);
    expect(stats.taxCollectedCents).toBe(-826);
    // Exact cost reversal from the ORIGINAL sale item (cross-period lookup).
    expect(stats.returnedCostReversalCents).toBe(4000);
    expect(stats.returnedProfitReversalCents).toBe(9174 - 4000);
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expectInvariants(stats);
  });

  it('3b: the ORIGINAL period (recomputed) keeps the revenue — the refund belongs to the later period', () => {
    const original = mkSale({
      id: 'old-2', createdAt: AT('12:00:00'), status: 'refunded' as Sale['status'],
      items: [mkItem({ name: 'Case', price: 10000, qty: 1, cost: 4000 })],
      subtotal: 10000, total: 10000,
    });
    const ret = mkReturn({
      originalSaleId: 'old-2', originalInvoice: original.invoiceNumber,
      createdAt: '2026-07-20T15:00:00', // refund NEXT period
      subtotalCents: 10000, totalCents: 10000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));
    expect(stats.grossSalesCents).toBe(10000);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(0); // recognized 07-20, not here
    expect(stats.netSalesCents).toBe(10000);
    expectInvariants(stats);
  });

  it('5: CustomerReturn + REF-* audit sale (voided) + refunded original = ONE subtraction', () => {
    const original = mkSale({
      id: 'orig-5', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-5', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const ret = mkReturn({
      returnNumber: 'RTN-55', originalSaleId: 'orig-5', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-5', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 450, totalCents: 5450,
    });
    // ReturnsModule REF audit row: status VOIDED + isRefund + returnNumber.
    const refRow = mkSale({
      invoiceNumber: 'REF-RTN-55', status: 'voided' as Sale['status'],
      items: [mkItem({ name: 'Case', price: -5000, qty: 1 })],
      subtotal: -5000, taxAmount: -450, total: -5450,
      ...( { isRefund: true, returnNumber: 'RTN-55', refundFor: original.invoiceNumber } as Partial<Sale>),
    });
    const stats = computeReportMoneyStats(input({ sales: [original, refRow], customerReturns: [ret] }));
    expect(stats.grossSalesCents).toBe(5450);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(5450); // once, not 2x or 3x
    expect(stats.netSalesCents).toBe(0);
    expect(stats.netTaxCents).toBe(0);
    expectInvariants(stats);
  });

  it('5b: a COUNTABLE refund-audit row whose returnNumber matches a CustomerReturn is skipped (no double)', () => {
    const original = mkSale({
      id: 'orig-5b',
      items: [mkItem({ id: 'li-5b', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const ret = mkReturn({
      returnNumber: 'RTN-66', originalSaleId: 'orig-5b', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-5b', name: 'Case', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, totalCents: 2000,
    });
    // Hypothetical countable audit row for the SAME return (defensive dedup).
    const auditRow = mkSale({
      invoiceNumber: 'REF-RTN-66',
      items: [mkItem({ name: 'Case', price: -2000, qty: 1 })],
      subtotal: -2000, total: -2000,
      ...( { returnNumber: 'RTN-66' } as Partial<Sale>),
    });
    const stats = computeReportMoneyStats(input({ sales: [original, auditRow], customerReturns: [ret] }));
    expect(stats.returnAndRefundAdjustmentsCents).toBe(2000); // return wins, audit row skipped
    expect(stats.netSalesCents).toBe(3000);
    expectInvariants(stats);
  });

  it('6: LEGACY refunded sale with NO return record → deterministic self-reversal (period nets to 0, never overstated)', () => {
    const orphan = mkSale({
      id: 'orphan-1', status: 'refunded' as Sale['status'],
      items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const stats = computeReportMoneyStats(input({ sales: [orphan] }));
    expect(stats.grossSalesCents).toBe(5450);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(5450);
    expect(stats.netSalesCents).toBe(0);
    expect(stats.netTaxCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.profitAdjustmentEstimated).toBe(false); // exact self-reversal
    expectInvariants(stats);
  });

  it('7: MULTIPLE partial returns against one sale each subtract once', () => {
    const original = mkSale({
      id: 'multi-1',
      items: [mkItem({ id: 'li-m', name: 'Case', price: 2000, qty: 5, cost: 800 })],
      subtotal: 10000, total: 10000,
    });
    const r1 = mkReturn({
      originalSaleId: 'multi-1', originalInvoice: original.invoiceNumber, createdAt: AT('14:00:00'),
      items: [{ id: 'li-m', name: 'Case', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, totalCents: 2000,
    });
    const r2 = mkReturn({
      originalSaleId: 'multi-1', originalInvoice: original.invoiceNumber, createdAt: AT('17:00:00'),
      items: [{ id: 'li-m', name: 'Case', qty: 2, priceCents: 2000, subtotalCents: 4000, taxCents: 0, totalCents: 4000 }] as CustomerReturn['items'],
      subtotalCents: 4000, totalCents: 4000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [r1, r2] }));
    expect(stats.grossSalesCents).toBe(10000);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(6000);
    expect(stats.netSalesCents).toBe(4000);
    // Exact per-unit cost reversal: 800x1 + 800x2 = 2400.
    expect(stats.returnedCostReversalCents).toBe(2400);
    expect(stats.returnedProfitReversalCents).toBe(6000 - 2400);
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expectInvariants(stats);
  });

  it('8: returning ONE line of a multi-item sale reverses only that line (exact cost by item id)', () => {
    const original = mkSale({
      id: 'multi-2',
      items: [
        mkItem({ id: 'li-a', name: 'Case', price: 3000, qty: 1, cost: 1000 }),
        mkItem({ id: 'li-b', name: 'Charger', price: 2000, qty: 1, cost: 500 }),
      ],
      subtotal: 5000, total: 5000,
    });
    const ret = mkReturn({
      originalSaleId: 'multi-2', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-b', name: 'Charger', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, totalCents: 2000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));
    expect(stats.netSalesCents).toBe(3000);
    expect(stats.returnedCostReversalCents).toBe(500);          // only the Charger cost
    expect(stats.returnedProfitReversalCents).toBe(1500);       // 2000 - 500
    expect(stats.totalProfitCents).toBe((3000 - 1000) + (2000 - 500) - 1500); // Case profit stands
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expectInvariants(stats);
  });

  it('I1.2 REQUIRED EXAMPLE — exchange with additional payment: net $80 / COGS $30 / profit $50 (tests 1/2/10/11/12)', () => {
    // Original: $50 item, cost $20. Exchange: new item $80 (cost $30),
    // credit $50, customer pays $30 more.
    const original = mkSale({
      id: 'ex-1', items: [mkItem({ id: 'li-x', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-1', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-x', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
      ...( { exchangeSaleId: 'repl-1' } as Partial<CustomerReturn>),
    });
    const replacement = mkSale({
      id: 'repl-1',
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: 3000, total: 3000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    // 10: revenue credit represented exactly once (the credit line) — the
    // return record adds NO extra revenue subtraction.
    expect(stats.grossSalesCents).toBe(8000);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(0);
    expect(stats.netSalesCents).toBe(8000);
    // 11: returned item's $20 cost LEAVES COGS exactly once (exact, by id).
    expect(stats.exchangeReturnedCostReversalCents).toBe(2000);
    expect(stats.exchangeCreditCents).toBe(5000);
    // 12: replacement $30 cost stays → final COGS $30, profit $50.
    expect(stats.totalCostCents).toBe(3000);
    expect(stats.totalProfitCents).toBe(5000);
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expectInvariants(stats);
  });

  it('I1.2 test 3 — replacement CHEAPER than credit (negative replacement total, no refund marker → gross pass-through)', () => {
    const original = mkSale({
      id: 'ex-2', items: [mkItem({ id: 'li-y', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-2', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-y', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Cheaper Case', price: 3000, qty: 1, cost: 1000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: -2000, total: -2000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    // Customer ends up with a $30 item (cost $10): net revenue $30,
    // final COGS $10, profit $20.
    expect(stats.netSalesCents).toBe(3000);
    expect(stats.totalCostCents).toBe(1000);   // (2000 + 1000) − 2000 reversal
    expect(stats.totalProfitCents).toBe(2000);
    expectInvariants(stats);
  });

  it('I1.2 test 4 — CROSS-PERIOD exchange: current period reflects only current activity', () => {
    const original = mkSale({
      id: 'ex-3', createdAt: '2026-07-01T12:00:00',
      items: [mkItem({ id: 'li-z', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-3', originalInvoice: original.invoiceNumber,
      createdAt: AT('15:00:00'), // exchange happens in the CURRENT period
      items: [{ id: 'li-z', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: 3000, total: 3000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    // Original sale is NOT copied into the current period.
    expect(stats.grossSalesCents).toBe(3000);
    expect(stats.netSalesCents).toBe(3000);
    // Returned cost restoration legitimately REDUCES current-period COGS
    // (exact, via cross-period original lookup): 3000 − 2000 = 1000.
    expect(stats.exchangeReturnedCostReversalCents).toBe(2000);
    expect(stats.totalCostCents).toBe(1000);
    // Current-period profit: replacement pair 0 + restored cost 2000.
    expect(stats.totalProfitCents).toBe(2000);
    // Combined with July-1 period (profit 3000) → 5000 = REQUIRED EXAMPLE.
    expectInvariants(stats);
  });

  it('I1.2 test 5 — exchange of ONE item from a multi-item original reverses only that item', () => {
    const original = mkSale({
      id: 'ex-4',
      items: [
        mkItem({ id: 'li-k1', name: 'Case', price: 3000, qty: 1, cost: 1000 }),
        mkItem({ id: 'li-k2', name: 'Charger', price: 2000, qty: 1, cost: 500 }),
      ],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-4', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-k2', name: 'Charger', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, totalCents: 2000,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Fast Charger', price: 3500, qty: 1, cost: 1200 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -2000, qty: 1, taxable: false }),
      ],
      subtotal: 1500, total: 1500,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    expect(stats.exchangeReturnedCostReversalCents).toBe(500); // only the Charger
    expect(stats.totalCostCents).toBe(1000 + 500 + 1200 - 500); // Case + Charger + FastCharger − reversal
    expectInvariants(stats);
  });

  it('I1.2 tests 7/8/9 — exchange cost tiers: explicit zero / inventory fallback / estimated', () => {
    // 7: explicit zero original cost → reversal 0, EXACT (not estimated).
    const origZero = mkSale({ id: 'ex-z', items: [mkItem({ id: 'li-0', name: 'Promo', price: 4000, qty: 1, cost: 0 })], subtotal: 4000, total: 4000 });
    const retZero = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-z', originalInvoice: origZero.invoiceNumber,
      items: [{ id: 'li-0', name: 'Promo', qty: 1, priceCents: 4000, subtotalCents: 4000, taxCents: 0, totalCents: 4000 }] as CustomerReturn['items'],
      subtotalCents: 4000, totalCents: 4000,
    });
    const s7 = computeReportMoneyStats(input({ sales: [origZero], customerReturns: [retZero] }));
    expect(s7.exchangeReturnedCostReversalCents).toBe(0);
    expect(s7.profitAdjustmentEstimated).toBe(false);

    // 8: legacy MISSING cost → inventory fallback via inventoryId.
    const legacyItem = mkItem({ id: 'li-m8', name: 'Old Case', price: 4000, qty: 1, inventoryId: 'inv-8' });
    delete (legacyItem as Partial<SaleItem>).cost;
    const origLegacy = mkSale({ id: 'ex-m8', items: [legacyItem], subtotal: 4000, total: 4000 });
    const retLegacy = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-m8', originalInvoice: origLegacy.invoiceNumber,
      items: [{ id: 'li-m8', name: 'Old Case', qty: 1, priceCents: 4000, subtotalCents: 4000, taxCents: 0, totalCents: 4000 }] as CustomerReturn['items'],
      subtotalCents: 4000, totalCents: 4000,
    });
    const inv8 = [{ id: 'inv-8', name: 'Old Case', cost: 1500 } as unknown as InventoryItem];
    const s8 = computeReportMoneyStats(input({ sales: [origLegacy], customerReturns: [retLegacy], inventory: inv8 }));
    expect(s8.exchangeReturnedCostReversalCents).toBe(1500);
    expect(s8.profitAdjustmentEstimated).toBe(false);

    // 9: no original sale resolvable → ESTIMATED and flagged.
    const someSale = mkSale({ items: [mkItem({ name: 'Filler', price: 10000, qty: 1, cost: 4000 })], subtotal: 10000, total: 10000 });
    const retLost = mkReturn({
      resolution: 'exchange', originalSaleId: 'missing-sale', originalInvoice: 'GONE-1',
      items: [{ name: 'Mystery', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, totalCents: 2000,
    });
    const s9 = computeReportMoneyStats(input({ sales: [someSale], customerReturns: [retLost] }));
    // avg margin = 6000/10000 → est profit 1200 → est cost 800.
    expect(s9.exchangeReturnedCostReversalCents).toBe(800);
    expect(s9.profitAdjustmentEstimated).toBe(true);
  });

  it('I1.3 REQUIRED SAME-PERIOD taxable exchange — full reconciliation ($87 paid = $80 pre-tax + $7 net tax)', () => {
    // Original: $50 + $4.50 tax = $54.50, cost $20. Exchange: new $80
    // (+$7 tax), credit −$54.50 (tax-INCLUSIVE, production shape),
    // customer pays $32.50 more. Replacement cost $30.
    const original = mkSale({
      id: 'ex-t', items: [mkItem({ id: 'li-t', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-t', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-t', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 450, totalCents: 5450,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
      ],
      subtotal: 2550, salesTax: 700, total: 3250,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    // Customer paid total: 5450 + 3250 = 8700 ($87).
    expect(stats.grossSalesCents).toBe(8700);
    expect(stats.netSalesCents).toBe(8700);
    // Gross tax $11.50; embedded exchange tax $4.50 REFUNDED → net tax $7.
    expect(stats.grossTaxCollectedCents).toBe(1150);
    expect(stats.exchangeTaxRefundedCents).toBe(450);
    expect(stats.ordinaryTaxRefundedCents).toBe(0);
    expect(stats.taxRefundedCents).toBe(450);
    expect(stats.netTaxCents).toBe(700);
    // Pre-tax basis: raw subtotals 5000+2550=7550 + embedded tax 450 = 8000.
    expect(stats.grossRevenueBeforeTaxCents).toBe(7550);
    expect(stats.netRevenueBeforeTaxCents).toBe(8000);
    // Manual-review relation: 8700 total − 700 net tax = 8000 net pre-tax.
    expect(stats.netSalesCents - stats.netTaxCents).toBe(8000);
    // Credit composition: 5450 = 5000 pre-tax + 450 tax + 0 pass-through.
    expect(stats.exchangeCreditCents).toBe(5450);
    expect(stats.exchangeCreditPreTaxCents).toBe(5000);
    expect(stats.exchangeRefundedPassThroughCents).toBe(0);
    // COGS $30 / profit $50 (tax portion is NOT a merchandise loss).
    expect(stats.exchangeReturnedCostReversalCents).toBe(2000);
    expect(stats.totalCostCents).toBe(3000);
    expect(stats.totalProfitCents).toBe(5000);
    // Margin on corrected net pre-tax basis: 5000/8000 = 62.5%.
    expect(stats.profitMargin).toBe(62.5);
    expect(stats.profitMarginMeaningful).toBe(true);
    expect(stats.profitAdjustmentEstimated).toBe(false);
    expectInvariants(stats);
  });

  it('I1.3 REQUIRED CROSS-PERIOD taxable exchange — current view + combined reconciliation', () => {
    const original = mkSale({
      id: 'ex-tc', createdAt: '2026-07-01T12:00:00',
      items: [mkItem({ id: 'li-tc', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-tc', originalInvoice: original.invoiceNumber,
      createdAt: AT('15:00:00'),
      items: [{ id: 'li-tc', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 450, totalCents: 5450,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
      ],
      subtotal: 2550, salesTax: 700, total: 3250,
    });
    const inp = { sales: [original, replacement], customerReturns: [exchangeReturn] };
    // CURRENT period (07-10): only the replacement + the exchange event.
    const cur = computeReportMoneyStats(input(inp));
    expect(cur.grossSalesCents).toBe(3250);           // $32.50 collected now
    expect(cur.netSalesCents).toBe(3250);
    expect(cur.grossTaxCollectedCents).toBe(700);
    expect(cur.exchangeTaxRefundedCents).toBe(450);
    expect(cur.netTaxCents).toBe(250);                // $2.50
    expect(cur.netRevenueBeforeTaxCents).toBe(3000);  // 2550 + 450 = $30
    expect(cur.netSalesCents - cur.netTaxCents).toBe(3000); // manual review
    expect(cur.totalCostCents).toBe(1000);            // 3000 − 2000 restored
    expect(cur.totalProfitCents).toBe(2000);          // $20
    expectInvariants(cur);
    // ORIGINAL period (07-01): untouched by the later exchange.
    const prev = computeReportMoneyStats({
      ...input(inp),
      periodRange: normalizeLocalDayRange('2026-07-01', '2026-07-01'),
    });
    expect(prev.netSalesCents).toBe(5450);
    expect(prev.netTaxCents).toBe(450);
    expect(prev.netRevenueBeforeTaxCents).toBe(5000);
    expect(prev.totalCostCents).toBe(2000);
    expect(prev.totalProfitCents).toBe(3000);
    expectInvariants(prev);
    // COMBINED: pre-tax 8000, tax 700, total 8700, COGS 3000, profit 5000.
    expect(prev.netRevenueBeforeTaxCents + cur.netRevenueBeforeTaxCents).toBe(8000);
    expect(prev.netTaxCents + cur.netTaxCents).toBe(700);
    expect(prev.netSalesCents + cur.netSalesCents).toBe(8700);
    expect(prev.totalCostCents + cur.totalCostCents).toBe(3000);
    expect(prev.totalProfitCents + cur.totalProfitCents).toBe(5000);
  });

  it('I1.3 REQUIRED CHEAPER replacement with customer cash-back — no double tax, no double credit', () => {
    // Original $50+$4.50; replacement $30+$2.70; credit −$54.50 → customer
    // receives $21.80 (negative replacement total, gross pass-through).
    const original = mkSale({
      id: 'ex-ch', items: [mkItem({ id: 'li-ch', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-ch', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-ch', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 450, totalCents: 5450,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Cheaper Case', price: 3000, qty: 1, cost: 1000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
      ],
      subtotal: -2450, salesTax: 270, total: -2180,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    // Retained: 5450 − 2180 = 3270 ($32.70 = $30 merch + $2.70 tax).
    expect(stats.netSalesCents).toBe(3270);
    expect(stats.grossTaxCollectedCents).toBe(720);   // 450 + 270
    expect(stats.exchangeTaxRefundedCents).toBe(450);
    expect(stats.netTaxCents).toBe(270);              // no double tax
    expect(stats.netRevenueBeforeTaxCents).toBe(3000); // (5000 − 2450) + 450
    expect(stats.netSalesCents - stats.netTaxCents).toBe(3000);
    // Returned COGS reversed once; replacement COGS once.
    expect(stats.totalCostCents).toBe(1000);           // (2000+1000) − 2000
    expect(stats.totalProfitCents).toBe(2000);
    expectInvariants(stats);
  });

  it('I1.3 test 5 — TAX-EXEMPT exchange: zero embedded tax, unchanged behavior', () => {
    const original = mkSale({
      id: 'ex-nt', items: [mkItem({ id: 'li-nt', name: 'Service', price: 5000, qty: 1, cost: 2000, taxable: false })],
      subtotal: 5000, salesTax: 0, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-nt', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-nt', name: 'Service', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 0, totalCents: 5000,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Better Service', price: 8000, qty: 1, cost: 3000, taxable: false }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: 3000, salesTax: 0, total: 3000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    expect(stats.exchangeTaxRefundedCents).toBe(0);
    expect(stats.netTaxCents).toBe(0);
    expect(stats.netRevenueBeforeTaxCents).toBe(8000);
    expect(stats.totalProfitCents).toBe(5000);
    expectInvariants(stats);
  });

  it('I1.3 test 7 — exchange with MIXED taxable + exempt returned items splits tax correctly', () => {
    const original = mkSale({
      id: 'ex-mx',
      items: [
        mkItem({ id: 'li-mx1', name: 'Case', price: 3000, qty: 1, cost: 1000 }),                     // taxable
        mkItem({ id: 'li-mx2', name: 'Labor', price: 2000, qty: 1, cost: 0, taxable: false }),        // exempt
      ],
      subtotal: 5000, salesTax: 270, total: 5270,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-mx', originalInvoice: original.invoiceNumber,
      items: [
        { id: 'li-mx1', name: 'Case', qty: 1, priceCents: 3000, subtotalCents: 3000, taxCents: 270, totalCents: 3270 },
        { id: 'li-mx2', name: 'Labor', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 },
      ] as CustomerReturn['items'],
      subtotalCents: 5000, taxCents: 270, totalCents: 5270,
    });
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Bundle', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5270, qty: 1, taxable: false }),
      ],
      subtotal: 2730, salesTax: 720, total: 3450,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [exchangeReturn] }));
    expect(stats.exchangeTaxRefundedCents).toBe(270);     // taxable portion only
    expect(stats.exchangeCreditPreTaxCents).toBe(5000);
    expect(stats.netTaxCents).toBe(270 + 720 - 270);      // 720
    expect(stats.netRevenueBeforeTaxCents).toBe(5000 + 2730 + 270); // 8000
    expectInvariants(stats);
  });

  it('I1.3 test 8 — missing taxCents: composition-derived fallback (total − subtotal), documented', () => {
    const original = mkSale({
      id: 'ex-f8', items: [mkItem({ id: 'li-f8', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    // Legacy record: taxCents absent → normalization yields 0; total 5450 vs
    // subtotal 5000 proves 450 of embedded tax (ReturnsModule composition).
    const legacyReturn = {
      id: 'ret-f8', returnNumber: 'RTN-F8', originalInvoice: original.invoiceNumber,
      originalSaleId: 'ex-f8', customerName: 'X', customerPhone: '', employeeName: '',
      createdAt: AT('15:00:00'), reason: 'defective', resolution: 'exchange', notes: '',
      items: [{ id: 'li-f8', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5450 }],
      subtotalCents: 5000, totalCents: 5450,
    } as unknown as CustomerReturn;
    const replacement = mkSale({
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
      ],
      subtotal: 2550, salesTax: 700, total: 3250,
    });
    const stats = computeReportMoneyStats(input({ sales: [original, replacement], customerReturns: [legacyReturn] }));
    expect(stats.exchangeTaxRefundedCents).toBe(450); // derived from 5450 − 5000
    expect(stats.netTaxCents).toBe(700);
    expect(stats.netRevenueBeforeTaxCents).toBe(8000);
    expectInvariants(stats);
  });

  it('I1.2 test 14 — MARGIN EXAMPLE: partial return uses NET pre-tax denominator → 60%, not 48%', () => {
    // Gross pre-tax $100 (cost $40 → profit $60); return $20 (exact cost $8).
    const original = mkSale({
      id: 'mg-1',
      items: [mkItem({ id: 'li-mg', name: 'Case', price: 2000, qty: 5, cost: 800 })],
      subtotal: 10000, total: 10000,
    });
    const ret = mkReturn({
      originalSaleId: 'mg-1', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-mg', name: 'Case', qty: 1, priceCents: 2000, subtotalCents: 2000, taxCents: 0, totalCents: 2000 }] as CustomerReturn['items'],
      subtotalCents: 2000, totalCents: 2000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));
    expect(stats.grossRevenueBeforeTaxCents).toBe(10000);
    expect(stats.returnRevenueBeforeTaxAdjustmentCents).toBe(2000);
    expect(stats.netRevenueBeforeTaxCents).toBe(8000);
    expect(stats.profitMarginBasisCents).toBe(8000);
    expect(stats.totalProfitCents).toBe(4800); // 6000 − (2000−800)
    expect(stats.profitMarginMeaningful).toBe(true);
    expect(stats.profitMargin).toBe(60); // 4800/8000 — NOT 48
    expectInvariants(stats);
  });

  it('I1.2 tests 15/17 — FULL same-period refund: margin NOT meaningful, numeric 0, no NaN/Infinity', () => {
    const original = mkSale({
      id: 'mg-2', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-mg2', name: 'Case', price: 10000, qty: 1, cost: 4000 })],
      subtotal: 10000, total: 10000,
    });
    const ret = mkReturn({
      originalSaleId: 'mg-2', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-mg2', name: 'Case', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 0, totalCents: 10000 }] as CustomerReturn['items'],
      subtotalCents: 10000, totalCents: 10000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));
    expect(stats.netRevenueBeforeTaxCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.profitMarginMeaningful).toBe(false);
    expect(stats.profitMargin).toBe(0);
    expect(Number.isFinite(stats.profitMargin)).toBe(true);
    expectInvariants(stats);
  });

  it('I1.2 tests 16/17 — refund-only period: NEGATIVE net basis, margin NOT meaningful, no NaN/Infinity', () => {
    const original = mkSale({
      id: 'mg-3', createdAt: '2026-07-01T12:00:00', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-mg3', name: 'Case', price: 10000, qty: 1, cost: 4000 })],
      subtotal: 10000, total: 10000,
    });
    const ret = mkReturn({
      originalSaleId: 'mg-3', originalInvoice: original.invoiceNumber,
      createdAt: AT('15:00:00'),
      items: [{ id: 'li-mg3', name: 'Case', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 0, totalCents: 10000 }] as CustomerReturn['items'],
      subtotalCents: 10000, totalCents: 10000,
    });
    const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));
    expect(stats.netRevenueBeforeTaxCents).toBe(-10000);
    expect(stats.netSalesCents).toBe(-10000);
    expect(stats.profitMarginMeaningful).toBe(false);
    expect(stats.profitMargin).toBe(0);
    expect(Number.isFinite(stats.profitMargin)).toBe(true);
    expectInvariants(stats);
  });

  it('13/14: unlock represented inside a POS sale is never ALSO counted standalone', () => {
    const unlock = { id: 'U77', status: 'completed', price: 4000, cost: 1500, createdAt: AT('09:00:00') } as unknown as Unlock;
    const posSale = mkSale({
      items: [mkItem({ name: 'Unlock service', unlockId: 'U77', price: 4000, qty: 1 })],
      subtotal: 4000, total: 4000,
    });
    const stats = computeReportMoneyStats(input({ sales: [posSale], unlocks: [unlock] }));
    expect(stats.grossSalesCents).toBe(4000);           // once via POS, no standalone add
    expect(catRow(stats, 'Unlocks')).toMatchObject({ quantity: 1, revenueCents: 4000 });
    expectInvariants(stats);
  });
});
