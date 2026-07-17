// ============================================================
// CELLHUB-INTELLIGENCE-I2A — Intelligence ⇄ Reports money PARITY suite.
//
// Proves Reports and Intelligence CANNOT drift: every scenario feeds the
// SAME raw store fixture and the SAME LocalDayRange to (A) the canonical
// Reports money service directly and (B) the PUBLIC Intelligence paths
// (IntelligenceEngine.getTodayMetrics + cellhubDataAccess getTodaySummary /
// getEmployeePerformance / getPhonePaymentSummary). Expected values come
// ONLY from the canonical ReportMoneyStats result — never from a second
// hand-written reduce, and computeReportMoneyStats is NEVER mocked.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Sale, SaleItem, Repair, Unlock, Layaway, SpecialOrder, InventoryItem, CustomerReturn, StoreSettings } from '@/store/types';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';
import {
  computeCanonicalMoneyForRange, localDayRangeForDay, localDayRangeForIntelRange, toLocalYMD,
} from './reportMoneyAdapter';
import { getTodaySummary, getEmployeePerformance, getPhonePaymentSummary } from '@/services/intelligence/dataAccess/cellhubDataAccess';
import { handleIntent } from '@/services/intelligence/chat/handlers';
import type { IntentMatch } from '@/services/intelligence/chat/intentRouter';
import { normalizeLocalDayRange } from '@/utils/reportRange';

// ── Fixtures dated TODAY (getTodayMetrics resolves the current local day) ──
const NOW = new Date();
const TODAY_YMD = toLocalYMD(NOW);
const YESTERDAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1);
const YESTERDAY_YMD = toLocalYMD(YESTERDAY);
const AT = (time: string) => `${TODAY_YMD}T${time}`;
const AT_Y = (time: string) => `${YESTERDAY_YMD}T${time}`;
const SETTINGS = { defaultCommissionRate: 0.08, carrierCommissions: {} } as unknown as StoreSettings;
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
    status: 'completed' as Sale['status'], createdAt: AT('12:00:00'), ...over,
  } as Sale;
}
function mkReturn(over: Partial<CustomerReturn>): CustomerReturn {
  return {
    id: `ret-${++idSeq}`, returnNumber: `RTN-${idSeq}`, originalInvoice: '',
    originalSaleId: null, customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: AT('15:00:00'), reason: 'defective', resolution: 'cash', notes: '',
    items: [], subtotalCents: 0, taxCents: 0, totalCents: 0, ...over,
  } as CustomerReturn;
}

interface World {
  sales?: Sale[]; repairs?: Repair[]; unlocks?: Unlock[]; specialOrders?: SpecialOrder[];
  layaways?: Layaway[]; inventory?: InventoryItem[]; customerReturns?: CustomerReturn[];
  vendorReturns?: unknown[];
}

function buildEngine(w: World): IntelligenceEngine {
  return new IntelligenceEngine(
    w.sales ?? [], [], w.inventory ?? [], w.repairs ?? [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    {
      specialOrders: w.specialOrders ?? [], unlocks: w.unlocks ?? [], layaways: w.layaways ?? [],
      customerReturns: w.customerReturns ?? [], vendorReturns: w.vendorReturns ?? [],
      settings: SETTINGS as unknown as Record<string, unknown>,
    },
  );
}

/** Independent canonical reference — the ONLY source of expected values. */
function canonicalToday(w: World): ReportMoneyStats {
  return computeReportMoneyStats({
    sales: w.sales ?? [], repairs: w.repairs ?? [], unlocks: w.unlocks ?? [],
    specialOrders: w.specialOrders ?? [], layaways: w.layaways ?? [],
    inventory: w.inventory ?? [], customerReturns: w.customerReturns ?? [],
    vendorReturns: w.vendorReturns ?? [], settings: SETTINGS,
    periodRange: normalizeLocalDayRange(TODAY_YMD, TODAY_YMD),
    labels: LABELS,
  });
}

/** Field-mapping contract (documented):
 *  Intelligence.revenueCents  ⇄ canonical.netSalesCents
 *  Intelligence.transactions  ⇄ canonical.txCount
 *  Intelligence.returnsCents  ⇄ canonical.returnAndRefundAdjustmentsCents
 *  gross/netTax/voided/refunded/flags map 1:1 by name. */
function assertParity(w: World): { canonical: ReportMoneyStats; engine: IntelligenceEngine } {
  const canonical = canonicalToday(w);
  const engine = buildEngine(w);

  // Path B1: public engine DTO.
  const m = engine.getTodayMetrics();
  expect(m.revenueCents).toBe(canonical.netSalesCents);
  expect(m.netSalesCents).toBe(canonical.netSalesCents);
  expect(m.grossSalesCents).toBe(canonical.grossSalesCents);
  expect(m.returnsCents).toBe(canonical.returnAndRefundAdjustmentsCents);
  expect(m.netTaxCents).toBe(canonical.netTaxCents);
  expect(m.transactions).toBe(canonical.txCount);
  expect(m.voidedCount).toBe(canonical.voidedCount);
  expect(m.refundedCount).toBe(canonical.refundedCount);
  expect(m.profitMarginMeaningful).toBe(canonical.profitMarginMeaningful);
  expect(m.profitAdjustmentEstimated).toBe(canonical.profitAdjustmentEstimated);

  // Path B2: public dataAccess summary (today range).
  const sum = getTodaySummary(engine.canonicalMoneySnapshot());
  expect(sum.revenueCents).toBe(canonical.netSalesCents);
  expect(sum.count).toBe(canonical.txCount);
  expect(sum.grossSalesCents).toBe(canonical.grossSalesCents);
  expect(sum.netSalesCents).toBe(canonical.netSalesCents);
  expect(sum.returnsCents).toBe(canonical.returnAndRefundAdjustmentsCents);
  expect(sum.netTaxCents).toBe(canonical.netTaxCents);
  expect(sum.profitMarginMeaningful).toBe(canonical.profitMarginMeaningful);
  expect(sum.profitAdjustmentEstimated).toBe(canonical.profitAdjustmentEstimated);

  // Path B3: the engine snapshot through the adapter must equal the direct
  // canonical result on EVERY field (profit/cost/tax/margin included) —
  // proves the wiring feeds the complete, correct collections.
  const viaAdapter = computeCanonicalMoneyForRange(engine.canonicalMoneySnapshot(), localDayRangeForDay(NOW));
  expect(viaAdapter).toEqual(canonical);
  // Explicit money fields (spec list) — from the adapter'd Intelligence path:
  expect(viaAdapter.totalProfitCents).toBe(canonical.totalProfitCents);
  expect(viaAdapter.totalCostCents).toBe(canonical.totalCostCents);
  expect(viaAdapter.grossTaxCollectedCents).toBe(canonical.grossTaxCollectedCents);
  expect(viaAdapter.taxRefundedCents).toBe(canonical.taxRefundedCents);
  expect(viaAdapter.netRevenueBeforeTaxCents).toBe(canonical.netRevenueBeforeTaxCents);
  expect(viaAdapter.profitMargin).toBe(canonical.profitMargin);

  return { canonical, engine };
}

describe('I2A parity — Intelligence ⇄ Reports (same fixture, same local day)', () => {
  it('1/24: normal taxable sale + multiple payment methods', () => {
    const w: World = {
      sales: [
        mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 2, cost: 2000 })], subtotal: 10000, salesTax: 875, total: 10875, employeeName: 'Ana' }),
        mkSale({ items: [mkItem({ name: 'B', price: 7000, qty: 1, cost: 0 })], subtotal: 7000, total: 7000, paymentMethod: 'card' as Sale['paymentMethod'], employeeName: 'Beto' }),
        mkSale({
          items: [mkItem({ name: 'C', price: 4000, qty: 1, cost: 0 })], subtotal: 4000, total: 4000,
          paymentMethod: 'split' as Sale['paymentMethod'],
          splitPayment: { cash: 1000, card: 2500, storeCredit: 500 } as Sale['splitPayment'],
        }),
      ],
    };
    const { canonical, engine } = assertParity(w);
    expect(canonical.netSalesCents).toBe(21875);
    // Employee rows parity via the public dataAccess path:
    const rows = getEmployeePerformance(engine.canonicalMoneySnapshot(), 'today');
    expect(rows).toEqual(canonical.topEmployees);
  });

  it('2: tax-exempt in-POS repair', () => {
    const repair: Repair = { id: 'R1', parts: [{ cost: 1500, qty: 1 }], status: 'in_progress', createdAt: AT('09:00:00') } as unknown as Repair;
    assertParity({
      sales: [mkSale({ items: [mkItem({ name: 'Screen repair', repairId: 'R1', price: 8000, qty: 1, taxable: false })], subtotal: 8000, salesTax: 0, total: 8000 })],
      repairs: [repair],
    });
  });

  it('3: mixed product + service sale', () => {
    assertParity({
      sales: [mkSale({
        items: [
          mkItem({ name: 'Charger', price: 3000, qty: 1, cost: 1000 }),
          mkItem({ name: 'Data transfer', category: 'service' as SaleItem['category'], price: 2000, qty: 1, cost: 500 }),
        ],
        subtotal: 5000, salesTax: 263, total: 5263,
      })],
    });
  });

  it('4: voided sale excluded on both paths', () => {
    const { canonical } = assertParity({
      sales: [mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1 })], subtotal: 5000, salesTax: 450, total: 5450, status: 'voided' as Sale['status'] })],
    });
    expect(canonical.netSalesCents).toBe(0);
    expect(canonical.voidedCount).toBe(1);
  });

  it('5: same-period FULL refund → both paths report net 0 (never −total)', () => {
    const original = mkSale({
      id: 'orig-1', items: [mkItem({ id: 'li-1', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450, status: 'refunded' as Sale['status'],
    });
    const { canonical } = assertParity({
      sales: [original],
      customerReturns: [mkReturn({
        originalSaleId: 'orig-1', originalInvoice: original.invoiceNumber,
        items: [{ id: 'li-1', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
        subtotalCents: 5000, taxCents: 450, totalCents: 5450,
      })],
    });
    expect(canonical.netSalesCents).toBe(0);
    expect(canonical.refundedCount).toBe(1);
  });

  it('6: same-period partial return', () => {
    const original = mkSale({
      id: 'orig-2', items: [mkItem({ id: 'li-2', name: 'Case', price: 5000, qty: 2, cost: 2000 })],
      subtotal: 10000, salesTax: 875, total: 10875,
    });
    const { canonical } = assertParity({
      sales: [original],
      customerReturns: [mkReturn({
        originalSaleId: 'orig-2', originalInvoice: original.invoiceNumber,
        items: [{ id: 'li-2', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 438, totalCents: 5438 }] as CustomerReturn['items'],
        subtotalCents: 5000, taxCents: 438, totalCents: 5438,
      })],
    });
    expect(canonical.netSalesCents).toBe(10875 - 5438);
  });

  it('7/8/25/26: cross-period refund TODAY → negative day, negative net tax, margin not meaningful', () => {
    const original = mkSale({
      id: 'old-1', createdAt: AT_Y('12:00:00'), status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-9', name: 'Case', price: 9174, qty: 1, cost: 4000 })],
      subtotal: 9174, salesTax: 826, total: 10000,
    });
    const { canonical } = assertParity({
      sales: [original],
      customerReturns: [mkReturn({
        originalSaleId: 'old-1', originalInvoice: original.invoiceNumber, createdAt: AT('15:00:00'),
        items: [{ id: 'li-9', name: 'Case', qty: 1, priceCents: 9174, subtotalCents: 9174, taxCents: 826, totalCents: 10000 }] as CustomerReturn['items'],
        subtotalCents: 9174, taxCents: 826, totalCents: 10000,
      })],
    });
    // Negative day preserved end-to-end — no clamps anywhere.
    expect(canonical.netSalesCents).toBe(-10000);
    expect(canonical.netTaxCents).toBe(-826);
    expect(canonical.profitMarginMeaningful).toBe(false);
  });

  it('9: same-period exchange (I1.3 tax-inclusive credit)', () => {
    const original = mkSale({
      id: 'ex-t', items: [mkItem({ id: 'li-t', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    const { canonical } = assertParity({
      sales: [original, mkSale({
        items: [
          mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
          mkItem({ name: 'Exchange Credit', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
        ],
        subtotal: 2550, salesTax: 700, total: 3250,
      })],
      customerReturns: [mkReturn({
        resolution: 'exchange', originalSaleId: 'ex-t', originalInvoice: original.invoiceNumber,
        items: [{ id: 'li-t', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
        subtotalCents: 5000, taxCents: 450, totalCents: 5450,
      })],
    });
    expect(canonical.netSalesCents).toBe(8700);
    expect(canonical.netTaxCents).toBe(700);
  });

  it('10/11: cross-period exchange today + cheaper exchange with cash-back', () => {
    const origA = mkSale({
      id: 'ex-cp', createdAt: AT_Y('12:00:00'),
      items: [mkItem({ id: 'li-cp', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    assertParity({
      sales: [origA, mkSale({
        items: [
          mkItem({ name: 'Better Case', price: 8000, qty: 1, cost: 3000 }),
          mkItem({ name: 'Exchange Credit', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
        ],
        subtotal: 2550, salesTax: 700, total: 3250,
      })],
      customerReturns: [mkReturn({
        resolution: 'exchange', originalSaleId: 'ex-cp', originalInvoice: origA.invoiceNumber, createdAt: AT('15:00:00'),
        items: [{ id: 'li-cp', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
        subtotalCents: 5000, taxCents: 450, totalCents: 5450,
      })],
    });
    const origB = mkSale({
      id: 'ex-ch', items: [mkItem({ id: 'li-ch', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450,
    });
    assertParity({
      sales: [origB, mkSale({
        items: [
          mkItem({ name: 'Cheaper Case', price: 3000, qty: 1, cost: 1000 }),
          mkItem({ name: 'Exchange Credit', category: 'exchange_credit' as SaleItem['category'], price: -5450, qty: 1, taxable: false }),
        ],
        subtotal: -2450, salesTax: 270, total: -2180,
      })],
      customerReturns: [mkReturn({
        resolution: 'exchange', originalSaleId: 'ex-ch', originalInvoice: origB.invoiceNumber,
        items: [{ id: 'li-ch', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
        subtotalCents: 5000, taxCents: 450, totalCents: 5450,
      })],
    });
  });

  it('12/13: standalone completed repair in gross; POS-represented repair not doubled', () => {
    const standalone = { id: 'R9', status: 'completed', balance: 0, total: 12000, parts: [{ cost: 3000, qty: 1 }], laborCost: 2000, createdAt: AT('10:00:00') } as unknown as Repair;
    const { canonical } = assertParity({ repairs: [standalone] });
    expect(canonical.grossSalesCents).toBe(12000);

    const posRepair = { id: 'R10', status: 'completed', balance: 0, total: 8000, parts: [{ cost: 1500, qty: 1 }], createdAt: AT('09:00:00') } as unknown as Repair;
    const { canonical: c2 } = assertParity({
      repairs: [posRepair],
      sales: [mkSale({ items: [mkItem({ name: 'Screen repair', repairId: 'R10', price: 8000, qty: 1, taxable: false })], subtotal: 8000, total: 8000 })],
    });
    expect(c2.grossSalesCents).toBe(8000); // once, not 16000
  });

  it('14/15: standalone unlock in gross; POS-represented unlock not doubled', () => {
    const unlock = { id: 'U9', status: 'completed', price: 4000, cost: 1500, createdAt: AT('10:30:00') } as unknown as Unlock;
    const { canonical } = assertParity({ unlocks: [unlock] });
    expect(canonical.grossSalesCents).toBe(4000);

    const { canonical: c2 } = assertParity({
      unlocks: [unlock],
      sales: [mkSale({ items: [mkItem({ name: 'Unlock service', unlockId: 'U9', price: 4000, qty: 1 })], subtotal: 4000, total: 4000 })],
    });
    expect(c2.grossSalesCents).toBe(4000);
  });

  it('16/17: carrier payment + activation (provider/carrier split parity)', () => {
    const w: World = {
      sales: [mkSale({
        items: [
          mkItem({ name: 'H2O - 8055551234', category: 'phone_payment' as SaleItem['category'], price: 5000, qty: 1, carrier: 'H2O', ...( { commissionRate: 0.10 } as Partial<SaleItem>) }),
          mkItem({ name: 'Verizon Plan', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', isActivation: true, ...( { commissionRate: 0.10 } as Partial<SaleItem>) }),
        ],
        subtotal: 11000, utilityTax: 250, total: 11250,
      })],
    };
    const { canonical, engine } = assertParity(w);
    // Public dataAccess phone-payment path === canonical provider buckets
    // (activation lines excluded on BOTH sides — same classification).
    const sum = getPhonePaymentSummary(engine.canonicalMoneySnapshot(), 'today');
    const provs = Object.values(canonical.phonePaymentsByProvider);
    expect(sum.count).toBe(provs.reduce((s, p) => s + p.count, 0));
    expect(sum.revenueCents).toBe(provs.reduce((s, p) => s + p.totalCents, 0));
    expect(sum.count).toBe(1); // the activation plan line is NOT a bill payment
  });

  it('18/19: explicit zero cost stays zero; missing legacy cost falls back to inventory', () => {
    const legacyItem = mkItem({ name: 'Old Case', price: 4000, qty: 1 });
    delete (legacyItem as Partial<SaleItem>).cost;
    assertParity({
      sales: [
        mkSale({ items: [mkItem({ name: 'Freebie', price: 1000, qty: 1, cost: 0 })], subtotal: 1000, total: 1000 }),
        mkSale({ items: [legacyItem], subtotal: 4000, total: 4000 }),
      ],
      inventory: [
        { id: 'i1', name: 'Freebie', cost: 700 } as unknown as InventoryItem,
        { id: 'i2', name: 'Old Case', cost: 1500 } as unknown as InventoryItem,
      ],
    });
  });

  it('20: vendor return reduces COGS on both paths', () => {
    assertParity({
      sales: [mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })], subtotal: 5000, total: 5000 })],
      vendorReturns: [{ id: 'VR1', createdAt: AT('11:00:00'), totalValueCents: 500 }],
    });
  });

  it('21: itemless legacy return → estimated flag survives both paths', () => {
    const original = mkSale({
      id: 'est-1', items: [mkItem({ name: 'Case', price: 5000, qty: 2, cost: 2000 })],
      subtotal: 10000, total: 10000,
    });
    const { canonical } = assertParity({
      sales: [original],
      customerReturns: [mkReturn({ originalSaleId: 'est-1', originalInvoice: original.invoiceNumber, subtotalCents: 2000, totalCents: 2000 })],
    });
    expect(canonical.profitAdjustmentEstimated).toBe(true);
  });

  it('22: empty day — zeros everywhere, no NaN', () => {
    const { canonical, engine } = assertParity({});
    expect(canonical.netSalesCents).toBe(0);
    const m = engine.getTodayMetrics();
    expect(m.transactions).toBe(0);
    expect(m.avgTicketCents).toBe(0);
    expect(Number.isFinite(m.avgTicketCents)).toBe(true);
    expect(m.topSeller).toBeNull();
  });

  it('23: local-day boundaries — midnight in, 23:59:59.999 in, ±1ms out', () => {
    const startOfDay = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 23, 59, 59, 999);
    const beforeMidnight = new Date(startOfDay.getTime() - 1);
    const afterDay = new Date(endOfDay.getTime() + 1);
    const w: World = {
      sales: [
        mkSale({ items: [mkItem({ name: 'A', price: 100, qty: 1, cost: 0 })], subtotal: 100, total: 100, createdAt: startOfDay }),
        mkSale({ items: [mkItem({ name: 'B', price: 200, qty: 1, cost: 0 })], subtotal: 200, total: 200, createdAt: endOfDay }),
        mkSale({ items: [mkItem({ name: 'C', price: 999, qty: 1, cost: 0 })], subtotal: 999, total: 999, createdAt: beforeMidnight }),
        mkSale({ items: [mkItem({ name: 'D', price: 888, qty: 1, cost: 0 })], subtotal: 888, total: 888, createdAt: afterDay }),
      ],
    };
    const { canonical } = assertParity(w);
    expect(canonical.netSalesCents).toBe(300); // A + B only
    expect(canonical.txCount).toBe(2);
  });

  it('DST-safety note: the canonical local-day range always spans the full local day', () => {
    // normalizeLocalDayRange resolves 'YMD T00:00:00' in LOCAL time, so DST
    // transitions shrink/stretch the wall-clock span but every local
    // timestamp of the day stays inside [start, end] — asserted structurally.
    const r = localDayRangeForDay(NOW);
    expect(r.valid).toBe(true);
    expect(r.start.getHours()).toBe(0);
    expect(r.end.getHours()).toBe(23);
    expect(r.end.getTime()).toBeGreaterThan(r.start.getTime());
  });

  it('range converter parity: today equals Reports-normalized today; yesterday/week/month/30d valid', () => {
    expect(localDayRangeForIntelRange('today', NOW)).toEqual(normalizeLocalDayRange(TODAY_YMD, TODAY_YMD));
    expect(localDayRangeForIntelRange('yesterday', NOW)).toEqual(normalizeLocalDayRange(YESTERDAY_YMD, YESTERDAY_YMD));
    for (const rg of ['this_week', 'this_month', 'last_30_days'] as const) {
      const r = localDayRangeForIntelRange(rg, NOW);
      expect(r.valid).toBe(true);
      expect(r.end.getTime()).toBeGreaterThan(r.start.getTime());
    }
  });

  it('immutability + determinism through the Intelligence path', () => {
    const sale = mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 2000 })], subtotal: 5000, salesTax: 450, total: 5450 });
    const w: World = { sales: [sale] };
    const snapshot = JSON.stringify(w.sales);
    const a = buildEngine(w).getTodayMetrics();
    const b = buildEngine(w).getTodayMetrics();
    expect(a).toEqual(b);
    expect(JSON.stringify(w.sales)).toBe(snapshot);
  });
});

// ── Handler smoke tests (today_sales end-to-end) ─────────────

const TODAY_SALES_MATCH = { id: 'today_sales', confidence: 1, query: 'sales today' } as unknown as IntentMatch;

describe('I2A handler smoke — "How much did I sell today?"', () => {
  it('normal day: answer carries the canonical NET sales amount', () => {
    const w: World = { sales: [mkSale({ items: [mkItem({ name: 'Case', price: 5000, qty: 1, cost: 0 })], subtotal: 5000, salesTax: 450, total: 5450 })] };
    const res = handleIntent(TODAY_SALES_MATCH, buildEngine(w), 'en');
    expect(res.text).toContain('$54.50');
  });

  it('same-period full refund: answer reflects net ZERO, not a negative double refund', () => {
    const original = mkSale({
      id: 'sm-1', items: [mkItem({ id: 'li-s1', name: 'Case', price: 5000, qty: 1, cost: 2000 })],
      subtotal: 5000, salesTax: 450, total: 5450, status: 'refunded' as Sale['status'],
    });
    const w: World = {
      sales: [original],
      customerReturns: [mkReturn({
        originalSaleId: 'sm-1', originalInvoice: original.invoiceNumber,
        items: [{ id: 'li-s1', name: 'Case', qty: 1, priceCents: 5000, subtotalCents: 5000, taxCents: 450, totalCents: 5450 }] as CustomerReturn['items'],
        subtotalCents: 5000, taxCents: 450, totalCents: 5450,
      })],
    };
    const res = handleIntent(TODAY_SALES_MATCH, buildEngine(w), 'en');
    expect(res.text).toContain('$0.00');
    expect(res.text).not.toMatch(/-\$|\$-/); // no negative anywhere
  });

  it('refund-only day: the negative amount survives with its minus sign', () => {
    const original = mkSale({
      id: 'sm-2', createdAt: AT_Y('12:00:00'), status: 'refunded' as Sale['status'],
      items: [mkItem({ id: 'li-s2', name: 'Case', price: 10000, qty: 1, cost: 4000 })],
      subtotal: 10000, total: 10000,
    });
    const w: World = {
      sales: [original],
      customerReturns: [mkReturn({
        originalSaleId: 'sm-2', originalInvoice: original.invoiceNumber, createdAt: AT('15:00:00'),
        items: [{ id: 'li-s2', name: 'Case', qty: 1, priceCents: 10000, subtotalCents: 10000, taxCents: 0, totalCents: 10000 }] as CustomerReturn['items'],
        subtotalCents: 10000, totalCents: 10000,
      })],
    };
    const res = handleIntent(TODAY_SALES_MATCH, buildEngine(w), 'en');
    // COP renders negatives as "$-100.00" — the minus sign must survive.
    expect(res.text).toMatch(/-\$100\.00|\$-100\.00/);
  });

  it('empty day: distinct no-activity answer (not a calculation failure)', () => {
    const res = handleIntent(TODAY_SALES_MATCH, buildEngine({}), 'en');
    expect(res.kind).toBe('answer');
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.text).not.toContain('$');
  });

  it('privacy: the today DTO exposes NO profit numbers (ungated paths stay safe)', () => {
    const m = buildEngine({ sales: [mkSale({ items: [mkItem({ name: 'X', price: 1000, qty: 1, cost: 100 })], subtotal: 1000, total: 1000 })] }).getTodayMetrics();
    expect('totalProfitCents' in m).toBe(false);
    expect('profitCents' in m).toBe(false);
    expect('totalCostCents' in m).toBe(false);
  });
});
