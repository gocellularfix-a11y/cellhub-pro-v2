// ============================================================
// CELLHUB-INTELLIGENCE-I2B-0.2 — P3 orphan-refund cost reversal.
//
// A LEGACY refunded original with NO money record anywhere (no
// CustomerReturn, no REFUND row) self-reverses in its own period. The cost
// reversal now comes from the DIRECT per-line accumulator — byId is a
// lookup structure only, so legacy no-ID lines and duplicate-ID lines must
// reverse exactly once. P1 (linked returns), P2 (REFUND audit rows) and
// exchanges are locked unchanged. Expected costs come from fixture cents or
// the canonical per-sale exposure — never an independent formula.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Sale, SaleItem, CustomerReturn, InventoryItem } from '@/store/types';
import {
  computeReportMoneyStats,
  checkReportMoneyInvariants,
} from './computeReportMoneyStats';
import type { ReportMoneyStatsInput } from './computeReportMoneyStats';
import { normalizeLocalDayRange } from '@/utils/reportRange';

const JUNE = normalizeLocalDayRange('2026-06-01', '2026-06-30');
const LABELS = { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' };

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
    taxAmount: 0, cbeTotal: 0, total: 0,
    paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'], createdAt: '2026-06-10T12:00:00', ...over,
  } as Sale;
}
function mkReturn(over: Partial<CustomerReturn>): CustomerReturn {
  return {
    id: `ret-${++idSeq}`, returnNumber: `RTN-${idSeq}`, originalInvoice: '',
    originalSaleId: null, customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: '2026-06-20T15:00:00', reason: 'defective', resolution: 'cash',
    notes: '', items: [], subtotalCents: 0, taxCents: 0, totalCents: 0, ...over,
  } as CustomerReturn;
}
function run(over: Partial<ReportMoneyStatsInput>): ReturnType<typeof computeReportMoneyStats> {
  return computeReportMoneyStats({
    sales: [], repairs: [], unlocks: [], specialOrders: [], layaways: [],
    inventory: [], customerReturns: [], vendorReturns: [],
    settings: {} as never, periodRange: JUNE, labels: LABELS, ...over,
  });
}
/** Orphan refunded original: status 'refunded', NO return, NO REFUND row. */
function orphan(items: SaleItem[], totals: Partial<Sale> = {}): Sale {
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  return mkSale({ status: 'refunded' as Sale['status'], items, subtotal, total: subtotal, ...totals });
}

describe('I2B-0.2 P3 required examples — direct line accumulator', () => {
  it('9: one NO-ID legacy item ($100 rev / $40 cost) — cost reverses exactly once', () => {
    const sale = orphan([{ ...mkItem({ name: 'Legacy', price: 10000, qty: 1, cost: 4000 }), id: undefined } as unknown as SaleItem]);
    const stats = run({ sales: [sale] });
    expect(stats.grossSalesCents).toBe(10000);
    expect(stats.returnAndRefundAdjustmentsCents).toBe(10000);
    expect(stats.netSalesCents).toBe(0);
    expect(stats.returnedCostReversalCents).toBe(4000);   // was 0 via byId
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.totalCostCents).toBe(0);                 // 4000 − 4000
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('10: TWO no-ID items ($60/$20 + $40/$15) — reversed cost $35, net profit $0', () => {
    const sale = orphan([
      { ...mkItem({ name: 'Legacy A', price: 6000, qty: 1, cost: 2000 }), id: undefined },
      { ...mkItem({ name: 'Legacy B', price: 4000, qty: 1, cost: 1500 }), id: undefined },
    ] as unknown as SaleItem[]);
    const stats = run({ sales: [sale] });
    expect(stats.returnedCostReversalCents).toBe(3500);
    expect(stats.netSalesCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('11: DUPLICATE item IDs ($20 + $15) — reversal $35, never the last map entry only', () => {
    const sale = orphan([
      mkItem({ id: 'dup-p3', name: 'Case A', price: 6000, qty: 1, cost: 2000 }),
      mkItem({ id: 'dup-p3', name: 'Case B', price: 4000, qty: 1, cost: 1500 }),
    ]);
    const stats = run({ sales: [sale] });
    expect(stats.returnedCostReversalCents).toBe(3500);   // was 1500 via byId overwrite
    expect(stats.totalProfitCents).toBe(0);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('12: duplicate NAMES — both lines reverse', () => {
    const sale = orphan([
      mkItem({ name: 'Screen Protector', price: 1500, qty: 1, cost: 500 }),
      mkItem({ name: 'Screen Protector', price: 1500, qty: 1, cost: 500 }),
    ]);
    const stats = run({ sales: [sale] });
    expect(stats.returnedCostReversalCents).toBe(1000);
    expect(stats.totalProfitCents).toBe(0);
  });
  it('13: EXPLICIT zero cost ($50 rev / cost 0) — cost reversal $0, profit reversal $50, net $0', () => {
    // Inventory contains a same-name item with a real cost — the explicit
    // zero must WIN (zero ≠ missing; no inventory fallback).
    const inventory = [{ id: 'inv-1', name: 'Freebie Case', cost: 900, price: 5000, quantity: 5 } as unknown as InventoryItem];
    const sale = orphan([mkItem({ name: 'Freebie Case', price: 5000, qty: 1, cost: 0 })]);
    const stats = run({ sales: [sale], inventory });
    expect(stats.returnedCostReversalCents).toBe(0);
    expect(stats.returnedProfitReversalCents).toBe(5000);
    expect(stats.netSalesCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('14: MISSING cost + canonical inventory fallback — reversal equals the per-sale exposure (invariant form)', () => {
    const inventory = [{ id: 'inv-2', name: 'Blue Case', cost: 900, price: 3000, quantity: 5 } as unknown as InventoryItem];
    const sale = orphan([mkItem({ name: 'Blue Case', price: 3000, qty: 1, cost: undefined as unknown as number })]);
    const stats = run({ sales: [sale], inventory });
    // No second cost formula: the expectation IS the canonical exposure.
    expect(stats.returnedCostReversalCents).toBe(stats.perSaleEconomics[sale.id].costCents);
    expect(stats.returnedCostReversalCents).toBeGreaterThan(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(stats.netSalesCents).toBe(0);
  });
  it('15: MIXED pseudo + real lines — pseudo keeps its policy (0 cost/0 profit), real reverses', () => {
    const sale = orphan([
      mkItem({ name: 'Layaway Deposit — iPhone', price: 5000, qty: 1 }), // pseudo, unlinked
      mkItem({ name: 'Case', price: 3000, qty: 1, cost: 1200 }),
    ]);
    const stats = run({ sales: [sale] });
    expect(stats.returnedCostReversalCents).toBe(1200);
    expect(stats.returnedProfitReversalCents).toBe(1800);  // only the real line carried profit
    expect(stats.netSalesCents).toBe(0);
    expect(stats.totalProfitCents).toBe(0);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('16: fully reversible orphan nets profit to zero alongside normal activity', () => {
    const normal = mkSale({ items: [mkItem({ name: 'Kept', price: 2000, qty: 1, cost: 700 })], subtotal: 2000, total: 2000 });
    const sale = orphan([{ ...mkItem({ name: 'Legacy', price: 10000, qty: 1, cost: 4000 }), id: undefined } as unknown as SaleItem]);
    const stats = run({ sales: [normal, sale] });
    expect(stats.netSalesCents).toBe(2000);
    expect(stats.totalProfitCents).toBe(1300);             // only the kept sale's profit remains
    expect(stats.returnedCostReversalCents).toBe(4000);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('P3 invariant: reversed cost === Σ per-line exposed cost of the refunded original', () => {
    const sale = orphan([
      { ...mkItem({ name: 'NoId', price: 3000, qty: 1, cost: 1100 }), id: undefined },
      mkItem({ id: 'dup-z', name: 'A', price: 1000, qty: 1, cost: 300 }),
      mkItem({ id: 'dup-z', name: 'B', price: 1000, qty: 1, cost: 250 }),
    ] as unknown as SaleItem[]);
    const stats = run({ sales: [sale] });
    const exposed = stats.perSaleEconomics[sale.id];
    expect(stats.returnedCostReversalCents).toBe(exposed.costCents);
    expect(exposed.costCents).toBe(exposed.lines.reduce((s, l) => s + l.costCents, 0));
    expect(stats.returnedCostReversalCents).toBe(1650);
  });
});

describe('I2B-0.2 tests 17-20 — P1 / P2 / exchange behavior UNCHANGED', () => {
  it('17: same-period linked CustomerReturn (P1) — reverses once via the return, P3 never double-fires', () => {
    const sale = mkSale({
      status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-p1', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const ret = mkReturn({
      originalSaleId: sale.id, originalInvoice: sale.invoiceNumber,
      items: [{ id: 'li-p1', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
    });
    const stats = run({ sales: [sale], customerReturns: [ret] });
    expect(stats.returnAndRefundAdjustmentsCents).toBe(5000); // once, not 10000
    expect(stats.netSalesCents).toBe(0);
    expect(stats.returnedCostReversalCents).toBe(2000);
    expect(stats.totalProfitCents).toBe(0);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('18: CROSS-PERIOD linked return — refund recognized at the refund date, negative period preserved', () => {
    const sale = mkSale({
      createdAt: '2026-05-10T12:00:00', status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-cp', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const ret = mkReturn({
      originalSaleId: sale.id, originalInvoice: sale.invoiceNumber,
      items: [{ id: 'li-cp', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
    });
    const stats = run({ sales: [sale], customerReturns: [ret] });
    expect(stats.grossSalesCents).toBe(0);                 // original is out of period
    expect(stats.netSalesCents).toBe(-5000);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('19: REFUND audit row (P2) — the countable negative row subtracts, P3 skips the linked original', () => {
    const original = mkSale({
      status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-p2', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const refundRow = mkSale({
      invoiceNumber: `REFUND-${original.invoiceNumber}`,
      ...({ refundFor: original.invoiceNumber } as Partial<Sale>),
      items: [mkItem({ id: 'li-p2r', name: 'Case', price: -5000, qty: 1 })],
      subtotal: -5000, total: -5000,
    });
    const stats = run({ sales: [original, refundRow] });
    expect(stats.netSalesCents).toBe(0);                   // 5000 − 5000, exactly once
    expect(stats.returnAndRefundAdjustmentsCents).toBe(5000);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
  it('20: exchange (I1.2 required example) — net $80 / COGS $30 / profit $50 unchanged', () => {
    const original = mkSale({
      id: 'ex-p3', createdAt: '2026-06-05T12:00:00',
      items: [mkItem({ id: 'li-ex', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, total: 5000,
    });
    const exchangeReturn = mkReturn({
      resolution: 'exchange', originalSaleId: 'ex-p3', originalInvoice: original.invoiceNumber,
      items: [{ id: 'li-ex', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 0, totalCents: 5000 }] as CustomerReturn['items'],
      subtotalCents: 5000, totalCents: 5000,
      ...({ exchangeSaleId: 'repl-p3' } as Partial<CustomerReturn>),
    });
    const replacement = mkSale({
      id: 'repl-p3', createdAt: '2026-06-20T16:00:00',
      items: [
        mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
        mkItem({ name: 'Exchange Credit RTN', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
      ],
      subtotal: 3000, total: 3000,
    });
    const stats = run({ sales: [original, replacement], customerReturns: [exchangeReturn] });
    expect(stats.netSalesCents).toBe(8000);
    expect(stats.totalCostCents).toBe(3000);
    expect(stats.totalProfitCents).toBe(5000);
    expect(checkReportMoneyInvariants(stats).ok).toBe(true);
  });
});
