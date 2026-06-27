// ============================================================
// R-INTELLIGENCE-EOD-A2A — Tender / fees / tax DATA CORE.
//
// Proves getTodayMoney() + composeEODBrief() aggregate the tender and
// fees/tax breakdowns from EXISTING Sale fields only, over the same
// today + non-voided set used for gross. No new tax/checkout math; this
// is pure display aggregation. Rendering (bilingual labels) is deferred
// to A2B, so these tests assert the MODEL, not chat text.
//
// getTodayMoney() anchors "today" to real local midnight (not injectable),
// so test sales are dated relative to real now (today-noon).
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { composeEODBrief } from './eodBriefComposer';

const DAY = 86_400_000;

function isoTodayNoon(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}
function isoYesterdayNoon(): string {
  const d = new Date(Date.now() - DAY);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function buildEngine(sales: any[], returns: any[] = []): IntelligenceEngine {
  return new IntelligenceEngine(
    sales as any,
    [], [], [],
    {},
    { customerReturns: returns as any, settings: {} } as any,
  );
}

// Minimal completed sale with a single known-cost accessory line.
function sale(over: Record<string, any> = {}): any {
  return {
    id: over.id ?? 's1',
    invoiceNumber: over.invoiceNumber ?? 'INV',
    createdAt: over.createdAt ?? isoTodayNoon(),
    status: over.status ?? 'completed',
    paymentMethod: over.paymentMethod ?? 'cash',
    total: over.total ?? 10000,
    items: over.items ?? [
      { id: 'i', name: 'Glass', category: 'accessory', price: over.total ?? 10000, qty: 1, cost: 6000 },
    ],
    ...over,
  };
}

describe('getTodayMoney — tender aggregation (A2A)', () => {
  it('buckets cash / card / store_credit by payment method and reconciles to gross', () => {
    const engine = buildEngine([
      sale({ id: 'a', paymentMethod: 'cash', total: 10000 }),
      sale({ id: 'b', paymentMethod: 'Card', total: 5000 }),        // legacy capitalized
      sale({ id: 'c', paymentMethod: 'Store Credit', total: 3000 }), // legacy spaced
    ]);
    const m = engine.getTodayMoney();
    expect(m.tenderBreakdown.cashCents).toBe(10000);
    expect(m.tenderBreakdown.cardCents).toBe(5000);
    expect(m.tenderBreakdown.storeCreditCents).toBe(3000);
    expect(m.tenderBreakdown.otherCents).toBe(0);
    expect(m.hasSalesData).toBe(true);
    // Reconciliation invariant: tender sum === grossRevenueCents.
    const tenderSum =
      m.tenderBreakdown.cashCents + m.tenderBreakdown.cardCents +
      m.tenderBreakdown.storeCreditCents + m.tenderBreakdown.externalCents +
      m.tenderBreakdown.otherCents;
    expect(tenderSum).toBe(m.grossRevenueCents);
  });

  it('decomposes a split payment using stored split buckets', () => {
    const engine = buildEngine([
      sale({
        id: 'sp', paymentMethod: 'Split', total: 10000,
        splitPayment: { cash: 4000, card: 5000, storeCredit: 1000 },
      }),
    ]);
    const m = engine.getTodayMoney();
    expect(m.tenderBreakdown.cashCents).toBe(4000);
    expect(m.tenderBreakdown.cardCents).toBe(5000);
    expect(m.tenderBreakdown.storeCreditCents).toBe(1000);
    expect(m.tenderBreakdown.otherCents).toBe(0);
  });

  it('routes unknown/legacy payment methods to otherCents (still reconciles)', () => {
    const engine = buildEngine([sale({ id: 'x', paymentMethod: 'crypto', total: 7000 })]);
    const m = engine.getTodayMoney();
    expect(m.tenderBreakdown.otherCents).toBe(7000);
    expect(m.tenderBreakdown.cashCents).toBe(0);
  });

  it('excludes a voided sale from tender, fees AND gross', () => {
    const engine = buildEngine([
      sale({ id: 'ok', paymentMethod: 'cash', total: 10000, salesTax: 800 }),
      sale({ id: 'void', paymentMethod: 'card', total: 99999, status: 'voided', salesTax: 9999 }),
    ]);
    const m = engine.getTodayMoney();
    expect(m.tenderBreakdown.cashCents).toBe(10000);
    expect(m.tenderBreakdown.cardCents).toBe(0);            // voided card sale excluded
    expect(m.feesAndTaxes.salesTaxCents).toBe(800);          // voided tax excluded
    expect(m.grossRevenueCents).toBe(10000);
  });

  it('excludes yesterday from today tender', () => {
    const engine = buildEngine([
      sale({ id: 'today', paymentMethod: 'cash', total: 10000, createdAt: isoTodayNoon() }),
      sale({ id: 'yest', paymentMethod: 'cash', total: 5000, createdAt: isoYesterdayNoon() }),
    ]);
    const m = engine.getTodayMoney();
    expect(m.tenderBreakdown.cashCents).toBe(10000);
  });
});

describe('getTodayMoney — fees / tax aggregation (A2A)', () => {
  it('surfaces salesTax and utilityTax from existing fields', () => {
    const engine = buildEngine([
      sale({ id: 'a', total: 10000, salesTax: 800, utilityTax: 150 }),
      sale({ id: 'b', total: 10000, salesTax: 200, utilityTax: 50 }),
    ]);
    const m = engine.getTodayMoney();
    expect(m.feesAndTaxes.salesTaxCents).toBe(1000);
    expect(m.feesAndTaxes.utilityTaxCents).toBe(200);
  });

  it('surfaces cbe / screen / mobility / creditCard fees and totals them', () => {
    const engine = buildEngine([
      sale({
        id: 'fees', total: 10000,
        salesTax: 800, utilityTax: 100, mobileSurcharge: 50,
        cbeTotal: 30, screenFeeTotal: 20, creditCardFee: 300,
      }),
    ]);
    const m = engine.getTodayMoney();
    const f = m.feesAndTaxes;
    expect(f.salesTaxCents).toBe(800);
    expect(f.utilityTaxCents).toBe(100);
    expect(f.caMobilityFeeCents).toBe(50);
    expect(f.cbeFeeCents).toBe(30);
    expect(f.screenFeeCents).toBe(20);
    expect(f.creditCardFeeCents).toBe(300);
    // totalCents === sum of every line above.
    expect(f.totalCents).toBe(800 + 100 + 50 + 30 + 20 + 300);
  });

  it('safely zeroes missing fee/tax fields without inventing values', () => {
    const engine = buildEngine([sale({ id: 'bare', total: 10000 })]);
    const m = engine.getTodayMoney();
    expect(m.feesAndTaxes.totalCents).toBe(0);
    expect(m.feesAndTaxes.salesTaxCents).toBe(0);
  });
});

describe('composeEODBrief — carries breakdown + flips available flags (A2A)', () => {
  it('flips tender/fees available true and carries real values', () => {
    const engine = buildEngine([
      sale({ id: 'a', paymentMethod: 'cash', total: 10000, salesTax: 800, creditCardFee: 0 }),
    ]);
    const { money } = composeEODBrief(engine, 'en', undefined, true);
    expect(money.tenderBreakdownAvailable).toBe(true);
    expect(money.feesAndTaxesAvailable).toBe(true);
    expect(money.tenderBreakdown.cashCents).toBe(10000);
    expect(money.feesAndTaxes.salesTaxCents).toBe(800);
    expect(money.feesAndTaxes.totalCents).toBe(800);
  });

  it('empty day → available flags false, all buckets zero', () => {
    const { money } = composeEODBrief(buildEngine([]), 'en', undefined, true);
    expect(money.tenderBreakdownAvailable).toBe(false);
    expect(money.feesAndTaxesAvailable).toBe(false);
    expect(money.tenderBreakdown.cashCents).toBe(0);
    expect(money.feesAndTaxes.totalCents).toBe(0);
  });

  it('returns-only day (no active sales) → available flags false', () => {
    const todayReturn = {
      id: 'rtn', returnNumber: 'RTN-1', originalInvoice: 'INV', originalSaleId: null,
      customerName: 'A', customerPhone: '1', employeeName: 'op',
      createdAt: isoTodayNoon(), reason: 'changed_mind', resolution: 'cash', notes: '',
      items: [], subtotalCents: 2000, taxCents: 0, totalCents: 2000,
    };
    const { money } = composeEODBrief(buildEngine([], [todayReturn]), 'en', undefined, true);
    expect(money.returnCount).toBe(1);
    expect(money.tenderBreakdownAvailable).toBe(false);
    expect(money.feesAndTaxesAvailable).toBe(false);
  });
});
