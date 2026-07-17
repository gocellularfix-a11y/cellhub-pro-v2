// ============================================================
// R-EOD-MONEY-WIRE — End-of-Day brief money wiring + privacy gate.
//
// Covers the five behaviors the wiring round must guarantee:
//   1. today-only filtering        (yesterday's sale excluded)
//   2. refund/return math          (returns subtract; profit adjusted)
//   3. owner sees profit/margin    (canSeeOwnerFinancials = true)
//   4. employee does NOT           (canSeeOwnerFinancials = false)
//   5. empty-day fallback          (no sales → "no sales yet", no fake $)
//
// Drives a REAL IntelligenceEngine so getTodayMoney's CANONICAL pipeline
// (computeReportMoneyStats via the report-money adapter — I2B-1) actually
// runs — not a stub. All money values are integer cents and >= 1000 so the
// schema adapter's dollar/cents heuristic leaves them untouched. Sales carry
// a realistic `subtotal` (the canonical pre-tax margin basis; legacy math
// ignored it).
//
// getTodayMoney() anchors "today" to the real local midnight (not injectable),
// so test sales are dated relative to the real now: a today-noon sale is
// always >= midnight today, a yesterday-noon sale always < midnight today.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { handleEndOfDayBrief } from './handleEndOfDayBrief';
import { composeEODBrief } from './eodBriefComposer';
// I2B-1: prove EOD money is the canonical Reports money — not a re-derived formula.
import { computeCanonicalMoneyForRange, localDayRangeForDay } from '../adapters/reportMoneyAdapter';

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

// $100 sale today, cost $60 → line profit $40 before refund adjustment.
const todaySale = {
  id: 's-today',
  invoiceNumber: 'INV-1',
  createdAt: isoTodayNoon(),
  status: 'completed',
  paymentMethod: 'cash',
  subtotal: 10000,     // pre-tax merchandise = canonical margin basis
  total: 10000,
  items: [
    { id: 'i1', name: 'Tempered Glass', category: 'accessory', price: 10000, qty: 1, cost: 6000 },
  ],
};

// $50 sale YESTERDAY — must be excluded from today's money.
const yesterdaySale = {
  id: 's-yesterday',
  invoiceNumber: 'INV-0',
  createdAt: isoYesterdayNoon(),
  status: 'completed',
  paymentMethod: 'cash',
  subtotal: 5000,
  total: 5000,
  items: [
    { id: 'i0', name: 'Cable', category: 'accessory', price: 5000, qty: 1, cost: 1000 },
  ],
};

// $20 return today.
const todayReturn = {
  id: 'rtn-1',
  returnNumber: 'RTN-1',
  originalInvoice: 'INV-1',
  originalSaleId: 's-today',
  customerName: 'Ana',
  customerPhone: '8050000000',
  employeeName: 'op',
  createdAt: isoTodayNoon(),
  reason: 'changed_mind',
  resolution: 'cash',
  notes: '',
  items: [],
  subtotalCents: 2000,
  taxCents: 0,
  totalCents: 2000,
};

function buildEngine(sales: any[], returns: any[] = []): IntelligenceEngine {
  return new IntelligenceEngine(
    sales as any,
    [],   // customers
    [],   // inventory
    [],   // repairs
    {},   // config
    { customerReturns: returns as any, settings: {} } as any,
  );
}

describe('getTodayMoney — today filter + refund math', () => {
  it('excludes yesterday, includes today, subtracts returns, adjusts profit', () => {
    const engine = buildEngine([todaySale, yesterdaySale], [todayReturn]);
    const m = engine.getTodayMoney();

    // I2B-1: the EOD money IS the canonical Reports money for this local day —
    // computed here independently through the canonical service and compared
    // field-by-field (not a re-implemented formula).
    const c = computeCanonicalMoneyForRange(engine.canonicalMoneySnapshot(), localDayRangeForDay(new Date()));
    expect(m.grossRevenueCents).toBe(c.grossSalesCents);
    expect(m.netRevenueCents).toBe(c.netSalesCents);
    expect(m.grossProfitCents).toBe(c.totalProfitCents);
    expect(m.returnedAmountCents).toBe(c.returnAndRefundAdjustmentsCents);

    // Only the $100 today sale counts toward gross (yesterday excluded).
    expect(m.grossRevenueCents).toBe(10000);
    // Net = gross − refunds = 10000 − 2000.
    expect(m.returnedAmountCents).toBe(2000);
    expect(m.netRevenueCents).toBe(8000);
    expect(m.returnCount).toBe(1);

    // Canonical: line profit (10000−6000)=4000; the $20 return has no item
    // cost, so its profit reversal is ESTIMATED at round(2000 × avgMargin 0.4)
    // = 800 → 3200. (Same value the legacy pipeline produced — now sourced
    // from computeReportMoneyStats and flagged profitAdjustmentEstimated.)
    expect(m.grossProfitCents).toBe(3200);
    // margin = 3200 / 8000 × 100 = 40.0
    expect(m.profitMarginPct).toBe(40);
    expect(m.profitEstimated).toBe(true);
    expect(m.marginMeaningful).toBe(true);
    expect(m.hasData).toBe(true);
  });

  it('empty day → all zeros, hasData false', () => {
    const m = buildEngine([]).getTodayMoney();
    expect(m.grossRevenueCents).toBe(0);
    expect(m.netRevenueCents).toBe(0);
    expect(m.grossProfitCents).toBe(0);
    expect(m.returnCount).toBe(0);
    expect(m.hasData).toBe(false);
  });
});

describe('composeEODBrief — privacy gate on the money section', () => {
  it('owner (canSee=true) → profit visible, real numbers, confidence partial', () => {
    const engine = buildEngine([todaySale], [todayReturn]);
    const { money } = composeEODBrief(engine, 'en', undefined, true);
    expect(money.profitVisible).toBe(true);
    expect(money.grossProfitCents).toBe(3200);
    expect(money.profitMarginPct).toBe(40);
    expect(money.grossRevenueCents).toBe(10000);
    // Core real; confidence stays 'partial' (render deferred to A2B).
    expect(money.confidence).toBe('partial');
    // R-INTELLIGENCE-EOD-A2A: tender + fees/taxes are now wired (data core).
    expect(money.tenderBreakdownAvailable).toBe(true);
    expect(money.feesAndTaxesAvailable).toBe(true);
    // The $100 cash sale shows up entirely under cash; tender reconciles to gross.
    expect(money.tenderBreakdown.cashCents).toBe(10000);
    expect(
      money.tenderBreakdown.cashCents +
        money.tenderBreakdown.cardCents +
        money.tenderBreakdown.storeCreditCents +
        money.tenderBreakdown.externalCents +
        money.tenderBreakdown.otherCents,
    ).toBe(money.grossRevenueCents);
  });

  it('employee (canSee=false) → profit/margin zeroed, revenue still present', () => {
    const engine = buildEngine([todaySale], [todayReturn]);
    const { money } = composeEODBrief(engine, 'en', undefined, false);
    expect(money.profitVisible).toBe(false);
    expect(money.grossProfitCents).toBe(0);
    expect(money.profitMarginPct).toBe(0);
    // Revenue is employee-allowed and stays real.
    expect(money.grossRevenueCents).toBe(10000);
    expect(money.netRevenueCents).toBe(8000);
  });

  it('empty day → confidence low (not placeholder, not partial)', () => {
    const { money } = composeEODBrief(buildEngine([]), 'en', undefined, true);
    expect(money.confidence).toBe('low');
  });
});

describe('handleEndOfDayBrief — rendering respects the gate', () => {
  it('owner sees profit + margin lines', () => {
    const engine = buildEngine([todaySale], [todayReturn]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, true);
    expect(res.text).toContain('$100.00');   // revenue
    expect(res.text).toContain('$32.00');     // profit
    expect(res.text).toContain('40.0');       // margin
    expect(res.text.toLowerCase()).toContain('profit');
  });

  it('employee sees revenue but NOT profit/margin', () => {
    const engine = buildEngine([todaySale], [todayReturn]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, false);
    expect(res.text).toContain('$100.00');           // revenue visible
    expect(res.text).not.toContain('$32.00');         // profit hidden
    expect(res.text.toLowerCase()).not.toContain('profit');
    expect(res.text.toLowerCase()).not.toContain('margin');
  });

  it('empty day → "no sales yet", never a fake $0.00 profit', () => {
    const res = handleEndOfDayBrief(buildEngine([]), 'en', undefined, true);
    expect(res.text.toLowerCase()).toContain('no sales');
    expect(res.text.toLowerCase()).not.toContain('profit');
  });
});
