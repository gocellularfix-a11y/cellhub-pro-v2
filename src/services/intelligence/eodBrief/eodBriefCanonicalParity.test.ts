// ============================================================
// CELLHUB-INTELLIGENCE-I2B-1 — EOD money === canonical Reports money.
//
// getTodayMoney() no longer runs the legacy computeCustomerProfit /
// adjustSalesItemCosts approximation: it projects the canonical report
// service (computeReportMoneyStats) for the local calendar day. These tests
// prove PARITY — for every scenario the EOD projection is compared FIELD BY
// FIELD against an INDEPENDENT canonical computation over the SAME engine
// snapshot (computeCanonicalMoneyForRange), never against a re-implemented
// formula. Negative values are asserted negative (no clamps).
//
// getTodayMoney() anchors "today" to the real local midnight (not injectable),
// so fixtures are dated relative to the real now.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { computeCanonicalMoneyForRange, localDayRangeForDay } from '../adapters/reportMoneyAdapter';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';

const DAY = 86_400_000;

function todayAt(h: number, m = 0): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
function daysAgoNoon(n: number): string {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function buildEngine(sales: any[], extras: Record<string, any> = {}): IntelligenceEngine {
  return new IntelligenceEngine(
    sales as any,
    [],   // customers
    (extras.inventory as any) ?? [],
    (extras.repairs as any) ?? [],
    {},   // config
    {
      unlocks: extras.unlocks ?? [],
      specialOrders: extras.specialOrders ?? [],
      layaways: extras.layaways ?? [],
      customerReturns: extras.customerReturns ?? [],
      vendorReturns: extras.vendorReturns ?? [],
      settings: extras.settings ?? {},
    } as any,
  );
}

function canonicalOf(engine: IntelligenceEngine): ReportMoneyStats {
  return computeCanonicalMoneyForRange(engine.canonicalMoneySnapshot(), localDayRangeForDay(new Date()));
}

/** THE parity contract: every money field the EOD exposes === the canonical
 *  value for the same local day. This is the whole point of the round. */
function assertParity(engine: IntelligenceEngine): { m: ReturnType<IntelligenceEngine['getTodayMoney']>; c: ReportMoneyStats } {
  const m = engine.getTodayMoney();
  const c = canonicalOf(engine);
  expect(m.grossRevenueCents).toBe(c.grossSalesCents);
  expect(m.netRevenueCents).toBe(c.netSalesCents);
  expect(m.grossProfitCents).toBe(c.totalProfitCents);
  expect(m.returnedAmountCents).toBe(c.returnAndRefundAdjustmentsCents);
  expect(m.costCents).toBe(c.totalCostCents);
  expect(m.grossTaxCents).toBe(c.grossTaxCollectedCents);
  expect(m.netTaxCents).toBe(c.netTaxCents);
  expect(m.transactionCount).toBe(c.txCount);
  expect(m.profitEstimated).toBe(c.profitAdjustmentEstimated);
  expect(m.marginMeaningful).toBe(c.profitMarginMeaningful);
  expect(m.profitMarginPct).toBe(Math.round(c.profitMargin * 10) / 10);
  // Tender + tax buckets are canonical too (only otherCents/creditCardFee are residuals).
  expect(m.tenderBreakdown.cashCents).toBe(c.cashCents);
  expect(m.tenderBreakdown.cardCents).toBe(c.cardCents);
  expect(m.tenderBreakdown.storeCreditCents).toBe(c.storeCreditCents);
  expect(m.feesAndTaxes.salesTaxCents).toBe(c.productSalesTaxCents);
  expect(m.feesAndTaxes.utilityTaxCents).toBe(c.utilityTaxCents);
  expect(m.feesAndTaxes.caMobilityFeeCents).toBe(c.mobilitySurchargeCents);
  expect(m.feesAndTaxes.cbeFeeCents).toBe(c.cbeCollectedCents);
  expect(m.feesAndTaxes.screenFeeCents).toBe(c.screenFeeCents);
  // No NaN / Infinity anywhere numeric.
  for (const v of [m.grossRevenueCents, m.netRevenueCents, m.grossProfitCents, m.profitMarginPct,
    m.costCents, m.grossTaxCents, m.netTaxCents, m.transactionCount, m.returnedAmountCents]) {
    expect(Number.isFinite(v)).toBe(true);
  }
  return { m, c };
}

// ── fixture builders ─────────────────────────────────────
function sale(over: Record<string, any> = {}): any {
  const total = over.total ?? 10000;
  return {
    id: over.id ?? 's', invoiceNumber: over.invoiceNumber ?? `INV-${over.id ?? 's'}`,
    createdAt: over.createdAt ?? todayAt(12), status: over.status ?? 'completed',
    paymentMethod: over.paymentMethod ?? 'cash',
    subtotal: over.subtotal ?? total, total,
    items: over.items ?? [{ id: `it-${over.id ?? 's'}`, name: 'Glass', category: 'accessory', price: total, qty: 1, cost: 6000 }],
    ...over,
  };
}
function ret(over: Record<string, any> = {}): any {
  return {
    id: over.id ?? 'r', returnNumber: over.returnNumber ?? `RTN-${over.id ?? 'r'}`,
    originalInvoice: over.originalInvoice ?? '', originalSaleId: over.originalSaleId ?? null,
    customerName: 'C', customerPhone: '1', employeeName: 'op',
    createdAt: over.createdAt ?? todayAt(15), reason: 'defective', resolution: over.resolution ?? 'cash',
    notes: '', items: over.items ?? [], subtotalCents: over.subtotalCents ?? 0,
    taxCents: over.taxCents ?? 0, totalCents: over.totalCents ?? 0, ...over,
  };
}

describe('I2B-1 EOD ⇄ Reports parity', () => {
  it('1. normal positive sales day', () => {
    const { m, c } = assertParity(buildEngine([
      sale({ id: 'a', total: 10000, salesTax: 800 }),
      sale({ id: 'b', total: 5000, paymentMethod: 'card', salesTax: 400 }),
    ]));
    expect(m.grossRevenueCents).toBe(15000);
    expect(m.netRevenueCents).toBe(c.netSalesCents);
    expect(m.marginMeaningful).toBe(true);
  });

  it('2. full refund of today\'s only sale → net 0', () => {
    const s = sale({ id: 'f', total: 10000, subtotal: 10000 });
    const r = ret({
      id: 'fr', originalSaleId: 'f', originalInvoice: s.invoiceNumber,
      items: [{ id: 'it-f', name: 'Glass', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 0, totalCents: 10000, cost: 6000 }],
      subtotalCents: 10000, totalCents: 10000,
    });
    const { m } = assertParity(buildEngine([s], { customerReturns: [r] }));
    expect(m.grossRevenueCents).toBe(10000);
    expect(m.netRevenueCents).toBe(0);
    expect(m.returnedAmountCents).toBe(10000);
  });

  it('3. partial refund', () => {
    const s = sale({ id: 'p', total: 10000, subtotal: 10000 });
    const r = ret({
      id: 'pr', originalSaleId: 'p', originalInvoice: s.invoiceNumber,
      items: [{ id: 'it-p', name: 'Glass', qty: 1, priceCents: 3000, subtotalCents: 3000, taxCents: 0, totalCents: 3000, cost: 1800 }],
      subtotalCents: 3000, totalCents: 3000,
    });
    const { m } = assertParity(buildEngine([s], { customerReturns: [r] }));
    expect(m.grossRevenueCents).toBe(10000);
    expect(m.returnedAmountCents).toBe(3000);
    expect(m.netRevenueCents).toBe(7000);
  });

  it('4. cross-period refund — original out of range, refund recognized today', () => {
    const s = sale({ id: 'cp', createdAt: daysAgoNoon(5), total: 10000, subtotal: 10000 });
    const r = ret({
      id: 'cpr', originalSaleId: 'cp', originalInvoice: s.invoiceNumber, createdAt: todayAt(14),
      items: [{ id: 'it-cp', name: 'Glass', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 0, totalCents: 10000, cost: 6000 }],
      subtotalCents: 10000, totalCents: 10000,
    });
    const { m } = assertParity(buildEngine([s], { customerReturns: [r] }));
    expect(m.grossRevenueCents).toBe(0);        // original out of today
    expect(m.returnedAmountCents).toBe(10000);
  });

  it('5. negative net-sales day (refund-only) — value stays negative, never clamped', () => {
    const s = sale({ id: 'ns', createdAt: daysAgoNoon(3), total: 8000, subtotal: 8000 });
    const r = ret({
      id: 'nsr', originalSaleId: 'ns', originalInvoice: s.invoiceNumber, createdAt: todayAt(16),
      items: [{ id: 'it-ns', name: 'Glass', qty: 1, priceCents: 8000, subtotalCents: 8000, taxCents: 0, totalCents: 8000, cost: 5000 }],
      subtotalCents: 8000, totalCents: 8000,
    });
    const { m } = assertParity(buildEngine([s], { customerReturns: [r] }));
    expect(m.netRevenueCents).toBe(-8000);
    expect(m.netRevenueCents).toBeLessThan(0);
    expect(m.marginMeaningful).toBe(false);     // no positive basis
  });

  it('6. negative net-tax day — tax refunded today with no gross tax', () => {
    const s = sale({ id: 'nt', createdAt: daysAgoNoon(4), total: 10800, subtotal: 10000, salesTax: 800 });
    const r = ret({
      id: 'ntr', originalSaleId: 'nt', originalInvoice: s.invoiceNumber, createdAt: todayAt(13),
      items: [{ id: 'it-nt', name: 'Glass', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 800, totalCents: 10800, cost: 6000 }],
      subtotalCents: 10000, taxCents: 800, totalCents: 10800,
    });
    const { m } = assertParity(buildEngine([s], { customerReturns: [r] }));
    expect(m.grossTaxCents).toBe(0);            // no sale tax collected today
    expect(m.netTaxCents).toBeLessThan(0);      // refunded tax → negative, unclamped
  });

  it('7. standalone repair + unlock revenue (no POS sale)', () => {
    const repair = { id: 'rep', customerId: 'x', status: 'picked_up', balance: 0, total: 9000,
      laborCost: 2000, parts: [{ id: 'p', name: 'Screen', price: 0, cost: 1500, qty: 1 }], createdAt: todayAt(10) };
    const unlock = { id: 'unl', customerId: 'x', status: 'completed', balance: 0, price: 4000, cost: 500, createdAt: todayAt(11) };
    const { m, c } = assertParity(buildEngine([], { repairs: [repair], unlocks: [unlock] }));
    expect(m.grossRevenueCents).toBe(c.grossSalesCents);
    expect(m.grossRevenueCents).toBeGreaterThan(0);   // standalones contribute to gross
    expect(m.transactionCount).toBe(c.txCount);       // txCount is POS sales (0 here)
  });

  it('8. exchange with COGS + tax split', () => {
    const original = sale({ id: 'exo', createdAt: todayAt(9), total: 5000, subtotal: 5000,
      items: [{ id: 'li-x', name: 'Case', price: 5000, qty: 1, cost: 2000 }] });
    const exchangeReturn = ret({
      id: 'exr', resolution: 'exchange', originalSaleId: 'exo', originalInvoice: original.invoiceNumber, createdAt: todayAt(15),
      items: [{ id: 'li-x', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }],
      subtotalCents: 5000, totalCents: 5000, exchangeSaleId: 'exr-repl',
    });
    const replacement = sale({ id: 'exr-repl', createdAt: todayAt(15), subtotal: 8000, total: 8000,
      items: [
        { id: 'li-b', name: 'Better Case', price: 8000, qty: 1, cost: 3000 },
        { id: 'li-c', name: 'Exchange Credit RTN', category: 'exchange_credit', price: -5000, qty: 1, taxable: false },
      ] });
    const { m, c } = assertParity(buildEngine([original, replacement], { customerReturns: [exchangeReturn] }));
    expect(m.netRevenueCents).toBe(c.netSalesCents);
    expect(m.costCents).toBe(c.totalCostCents);
    expect(m.grossProfitCents).toBe(c.totalProfitCents);
  });

  it('9. explicit zero cost — profit === revenue, not treated as missing', () => {
    const s = sale({ id: 'z', total: 5000, subtotal: 5000,
      items: [{ id: 'it-z', name: 'Freebie', category: 'accessory', price: 5000, qty: 1, cost: 0 }] });
    const { m, c } = assertParity(buildEngine([s]));
    expect(m.grossProfitCents).toBe(c.totalProfitCents);
    expect(m.grossProfitCents).toBe(5000);       // cost 0 → full margin
    expect(m.costCents).toBe(0);
  });

  it('10. missing cost with estimated-profit flag (return with no item cost)', () => {
    const s = sale({ id: 'mc', total: 10000, subtotal: 10000 });
    const r = ret({
      id: 'mcr', originalSaleId: 'mc', originalInvoice: s.invoiceNumber,
      items: [], subtotalCents: 2000, totalCents: 2000,   // no item cost → estimated reversal
    });
    const { m, c } = assertParity(buildEngine([s], { customerReturns: [r] }));
    expect(m.profitEstimated).toBe(true);
    expect(m.profitEstimated).toBe(c.profitAdjustmentEstimated);
  });

  it('11. cash / card / store-credit split payment', () => {
    const s = sale({ id: 'sp', total: 10000, subtotal: 10000, paymentMethod: 'split',
      splitPayment: { cash: 4000, card: 5000, storeCredit: 1000 } });
    const { m, c } = assertParity(buildEngine([s]));
    expect(m.tenderBreakdown.cashCents).toBe(c.cashCents);
    expect(m.tenderBreakdown.cardCents).toBe(c.cardCents);
    expect(m.tenderBreakdown.storeCreditCents).toBe(c.storeCreditCents);
    expect(m.tenderBreakdown.cashCents).toBe(4000);
    expect(m.tenderBreakdown.cardCents).toBe(5000);
    expect(m.tenderBreakdown.storeCreditCents).toBe(1000);
  });

  it('12. margin meaningful FALSE when canonical says so', () => {
    // Zero pre-tax basis (subtotal 0) → not meaningful; margin compat 0.
    const s = sale({ id: 'zm', total: 5000, subtotal: 0,
      items: [{ id: 'it-zm', name: 'X', category: 'accessory', price: 5000, qty: 1, cost: 2000 }] });
    const { m, c } = assertParity(buildEngine([s]));
    expect(m.marginMeaningful).toBe(false);
    expect(m.marginMeaningful).toBe(c.profitMarginMeaningful);
    expect(m.profitMarginPct).toBe(0);           // compat 0, not a conclusion
  });

  it('13. transaction count parity', () => {
    const { m, c } = assertParity(buildEngine([
      sale({ id: 't1', total: 3000 }), sale({ id: 't2', total: 4000 }), sale({ id: 't3', total: 5000 }),
    ]));
    expect(m.transactionCount).toBe(3);
    expect(m.transactionCount).toBe(c.txCount);
  });

  it('14. current-store scope — EOD projects exactly the scoped snapshot', () => {
    // Engine receives only store-A's (pre-scoped) sales; EOD === canonical over them.
    const storeA = [sale({ id: 'A1', storeId: 'A', total: 6000 }), sale({ id: 'A2', storeId: 'A', total: 4000 })];
    const { m, c } = assertParity(buildEngine(storeA));
    expect(m.grossRevenueCents).toBe(10000);
    expect(m.grossRevenueCents).toBe(c.grossSalesCents);
  });

  it('15. consolidated multi-store scope — parity over the combined snapshot', () => {
    const all = [
      sale({ id: 'A1', storeId: 'A', total: 6000 }),
      sale({ id: 'B1', storeId: 'B', total: 7000 }),
      sale({ id: 'L1', total: 2000 }),   // legacy no-storeId
    ];
    const { m, c } = assertParity(buildEngine(all));
    expect(m.grossRevenueCents).toBe(15000);
    expect(m.grossRevenueCents).toBe(c.grossSalesCents);
    expect(m.transactionCount).toBe(c.txCount);
  });

  it('16. local-day boundary — yesterday 23:59 excluded, today 00:00 included', () => {
    const justBeforeMidnight = new Date(Date.now() - DAY);
    justBeforeMidnight.setHours(23, 59, 0, 0);
    const s = [
      sale({ id: 'today', createdAt: todayAt(0, 1), total: 10000 }),         // today 00:01
      sale({ id: 'yest', createdAt: justBeforeMidnight.toISOString(), total: 9999 }), // yesterday 23:59
    ];
    const { m, c } = assertParity(buildEngine(s));
    expect(m.grossRevenueCents).toBe(10000);     // only today's sale
    expect(m.grossRevenueCents).toBe(c.grossSalesCents);
  });
});
