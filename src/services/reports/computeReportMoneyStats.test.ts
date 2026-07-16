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
  isCountableSale,
  isPseudoItem,
} from './computeReportMoneyStats';
import type { ReportMoneyStatsInput } from './computeReportMoneyStats';

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

describe('F7/F10 — fully refunded sale + CustomerReturn records', () => {
  const original = mkSale({
    id: 'orig-1',
    items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })],
    subtotal: 5000, salesTax: 450, total: 5450, status: 'refunded' as Sale['status'],
  });
  const ret: CustomerReturn = {
    id: 'ret-1', returnNumber: 'RTN-1', originalInvoice: original.invoiceNumber,
    originalSaleId: 'orig-1', customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: AT('15:00:00'), reason: 'defective', resolution: 'cash', notes: '', items: [],
    subtotalCents: 5000, taxCents: 450, totalCents: 5450,
  } as CustomerReturn;
  const stats = computeReportMoneyStats(input({ sales: [original], customerReturns: [ret] }));

  it('refunded original is excluded from gross/tax/categories; return subtracts to net', () => {
    expect(stats.grossRevenueCents).toBe(0);
    expect(stats.totalReturnsCents).toBe(5450);
    expect(stats.refundedCount).toBe(1);
    expect(stats.txCount).toBe(0);
    expect(stats.productSalesTaxCents).toBe(0);
  });
  it('PRESERVED (suspicious): same-period full refund yields NEGATIVE net (0 gross − 5450 returns)', () => {
    expect(stats.netRevenueCents).toBe(-5450);
  });
  it('taxCollected clamps at 0 via Math.max (return tax adjustment exceeds collected tax)', () => {
    expect(stats.customerReturnTaxAdjustmentCents).toBe(450);
    expect(stats.taxCollectedCents).toBe(0);
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

  it('gross keeps the original; net subtracts the return; tax nets the refunded tax', () => {
    expect(stats.grossRevenueCents).toBe(10875);
    expect(stats.totalReturnsCents).toBe(2175);
    expect(stats.netRevenueCents).toBe(8700);
    expect(stats.taxCollectedCents).toBe(700); // 875 − 175
  });
  it('PRESERVED: profit reduced by AVERAGE-margin assumption (60% of 2000 = 1200)', () => {
    // raw profit 6000; adjustment = round((6000/10000) * 2000) = 1200
    expect(stats.totalProfitCents).toBe(4800);
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
  it('zero-cost item: profit = revenue (no NaN, no fallback)', () => {
    const sale = mkSale({ items: [mkItem({ name: 'Freebie', price: 1000, qty: 1, cost: 0 })], subtotal: 1000, total: 1000 });
    const inv = [{ id: 'i1', name: 'Freebie', cost: 700 } as unknown as InventoryItem];
    const stats = computeReportMoneyStats(input({ sales: [sale], inventory: inv }));
    // cost 0 triggers the inventory name-match fallback → 700 (current behavior).
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
  it('standalone completed repair: parts+labor cost; enters categories, not gross', () => {
    const repair = {
      id: 'R9', status: 'completed', balance: 0, total: 12000,
      parts: [{ cost: 3000, qty: 1 }], laborCost: 2000, createdAt: AT('10:00:00'),
    } as unknown as Repair;
    const stats = computeReportMoneyStats(input({ repairs: [repair] }));
    expect(catRow(stats, 'Repairs')).toMatchObject({ quantity: 1, revenueCents: 12000, costCents: 5000, profitCents: 7000 });
    // PRESERVED: standalone repair revenue does NOT enter grossRevenueCents
    // (gross is sales+standalone unlocks only) — long-standing behavior.
    expect(stats.grossRevenueCents).toBe(0);
    expect(stats.completedRepairCount).toBe(1);
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

  it('post-edit refund sale (REF-*, status completed, negative total) subtracts from gross and buckets', () => {
    const good = mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 0 })], subtotal: 5000, salesTax: 450, total: 5450 });
    const refund = mkSale({
      invoiceNumber: 'REFUND-1',
      items: [mkItem({ name: 'Case', price: -2000, qty: 1, cost: 0 })],
      subtotal: -2000, salesTax: -175, total: -2175,
    });
    const stats = computeReportMoneyStats(input({ sales: [good, refund] }));
    expect(stats.grossRevenueCents).toBe(3275);   // 5450 − 2175
    expect(stats.productSalesTaxCents).toBe(275); // 450 − 175 (bucket-level reversal)
    expect(stats.cleanSalesCount).toBe(1);
    expect(stats.refundSalesCount).toBe(1);
  });

  it('date boundaries: 23:59:59 included, next-day 00:00:00 excluded', () => {
    const inSale = mkSale({ items: [mkItem({ name: 'A', price: 100, qty: 1, cost: 0 })], subtotal: 100, total: 100, createdAt: AT('23:59:59') });
    const outSale = mkSale({ items: [mkItem({ name: 'B', price: 999, qty: 1, cost: 0 })], subtotal: 999, total: 999, createdAt: '2026-07-11T00:00:00' });
    const stats = computeReportMoneyStats(input({ sales: [inSale, outSale] }));
    expect(stats.grossRevenueCents).toBe(100);
    expect(stats.txCount).toBe(1);
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
