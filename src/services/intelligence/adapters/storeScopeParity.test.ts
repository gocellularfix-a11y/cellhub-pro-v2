// ============================================================
// CELLHUB-INTELLIGENCE-I2A.1 — multi-store scope parity suite.
//
// Proves the canonical Intelligence money paths respect the EXACT same
// store scope as Reports. The scope boundary in production is
// AppProvider's filteredState, whose rule now lives in the shared pure
// module src/store/storeScope.ts (verbatim extraction). These tests scope
// every fixture with THAT real policy — never a test-local replica — and
// assert the public Intelligence paths against the canonical service fed
// the same scoped collections. No financial formula exists in this file.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Sale, SaleItem, Repair, Unlock, Layaway, SpecialOrder, InventoryItem, CustomerReturn, StoreSettings } from '@/store/types';
import { scopeCollection, belongsToStore, isUnscopedView } from '@/store/storeScope';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import { IntelligenceEngine } from '@/services/intelligence/IntelligenceEngine';
import { toLocalYMD } from './reportMoneyAdapter';
import type { CanonicalMoneySettings } from './reportMoneyAdapter';
import { getTodaySummary, getEmployeePerformance, getPhonePaymentSummary } from '@/services/intelligence/dataAccess/cellhubDataAccess';
import { normalizeLocalDayRange } from '@/utils/reportRange';

const NOW = new Date();
const TODAY_YMD = toLocalYMD(NOW);
const YESTERDAY_YMD = toLocalYMD(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1));
const AT = (t: string) => `${TODAY_YMD}T${t}`;
const AT_Y = (t: string) => `${YESTERDAY_YMD}T${t}`;
const LABELS = { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' };
const SETTINGS: CanonicalMoneySettings = { defaultCommissionRate: 0.08, carrierCommissions: {} };

let idSeq = 0;
function mkItem(over: Partial<SaleItem>): SaleItem {
  return {
    id: `it-${++idSeq}`, name: 'Item', category: 'accessory' as SaleItem['category'],
    price: 0, qty: 1, cbeEligible: false, taxable: true, ...over,
  } as SaleItem;
}
function mkSale(store: string | undefined, over: Partial<Sale>): Sale {
  return {
    id: `s-${++idSeq}`, invoiceNumber: `INV-${idSeq}`, storeId: store, items: [],
    subtotal: 0, taxAmount: 0, cbeTotal: 0, total: 0,
    paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'], createdAt: AT('12:00:00'), ...over,
  } as Sale;
}
function mkReturn(store: string | undefined, over: Partial<CustomerReturn>): CustomerReturn {
  return {
    id: `ret-${++idSeq}`, returnNumber: `RTN-${idSeq}`, storeId: store, originalInvoice: '',
    originalSaleId: null, customerName: 'X', customerPhone: '', employeeName: '',
    createdAt: AT('15:00:00'), reason: 'defective', resolution: 'cash', notes: '',
    items: [], subtotalCents: 0, taxCents: 0, totalCents: 0, ...over,
  } as CustomerReturn;
}

/** The GLOBAL (all-stores) dataset shared by every test. Stores A and B
 *  have intentionally different transactions on the same date. */
interface GlobalWorld {
  sales: Sale[]; repairs: Repair[]; unlocks: Unlock[]; specialOrders: SpecialOrder[];
  layaways: Layaway[]; inventory: InventoryItem[]; customerReturns: CustomerReturn[];
  vendorReturns: Array<{ id: string; storeId?: string; createdAt: string; totalValueCents: number }>;
}

function scopeWorld(w: GlobalWorld, storeId: string | null, consolidated: boolean): GlobalWorld {
  // THE real policy — src/store/storeScope.ts — applied to every per-store
  // collection, exactly like AppProvider's filteredState.
  return {
    sales: scopeCollection(w.sales, storeId, consolidated),
    repairs: scopeCollection(w.repairs as Array<Repair & { storeId?: string }>, storeId, consolidated),
    unlocks: scopeCollection(w.unlocks as Array<Unlock & { storeId?: string }>, storeId, consolidated),
    specialOrders: scopeCollection(w.specialOrders as Array<SpecialOrder & { storeId?: string }>, storeId, consolidated),
    layaways: scopeCollection(w.layaways as Array<Layaway & { storeId?: string }>, storeId, consolidated),
    inventory: scopeCollection(w.inventory as Array<InventoryItem & { storeId?: string }>, storeId, consolidated),
    customerReturns: scopeCollection(w.customerReturns, storeId, consolidated),
    vendorReturns: scopeCollection(w.vendorReturns, storeId, consolidated),
  };
}

function buildEngine(w: GlobalWorld, settings: CanonicalMoneySettings = SETTINGS): IntelligenceEngine {
  return new IntelligenceEngine(
    w.sales, [], w.inventory, w.repairs,
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    {
      specialOrders: w.specialOrders, unlocks: w.unlocks, layaways: w.layaways,
      customerReturns: w.customerReturns, vendorReturns: w.vendorReturns, settings,
    },
  );
}

function canonicalToday(w: GlobalWorld, settings: CanonicalMoneySettings = SETTINGS): ReportMoneyStats {
  return computeReportMoneyStats({
    sales: w.sales, repairs: w.repairs, unlocks: w.unlocks, specialOrders: w.specialOrders,
    layaways: w.layaways, inventory: w.inventory, customerReturns: w.customerReturns,
    vendorReturns: w.vendorReturns, settings: settings as StoreSettings,
    periodRange: normalizeLocalDayRange(TODAY_YMD, TODAY_YMD), labels: LABELS,
  });
}

/** Full public-path parity for one scoped world. */
function assertScopedParity(w: GlobalWorld, settings: CanonicalMoneySettings = SETTINGS): ReportMoneyStats {
  const canonical = canonicalToday(w, settings);
  const engine = buildEngine(w, settings);
  const m = engine.getTodayMetrics();
  expect(m.netSalesCents).toBe(canonical.netSalesCents);
  expect(m.grossSalesCents).toBe(canonical.grossSalesCents);
  expect(m.returnsCents).toBe(canonical.returnAndRefundAdjustmentsCents);
  expect(m.netTaxCents).toBe(canonical.netTaxCents);
  expect(m.transactions).toBe(canonical.txCount);
  expect(m.voidedCount).toBe(canonical.voidedCount);
  expect(m.refundedCount).toBe(canonical.refundedCount);
  const sum = getTodaySummary(engine.canonicalMoneySnapshot());
  expect(sum.revenueCents).toBe(canonical.netSalesCents);
  expect(getEmployeePerformance(engine.canonicalMoneySnapshot(), 'today')).toEqual(canonical.topEmployees);
  const provs = Object.values(canonical.phonePaymentsByProvider);
  const pp = getPhonePaymentSummary(engine.canonicalMoneySnapshot(), 'today');
  expect(pp.count).toBe(provs.reduce((s, p) => s + p.count, 0));
  expect(pp.revenueCents).toBe(provs.reduce((s, p) => s + p.totalCents, 0));
  return canonical;
}

/** The shared two-store dataset (same day, intentionally different values). */
function makeGlobalWorld(): GlobalWorld {
  return {
    sales: [
      // Store A: taxable product sale + phone payment + an employee.
      mkSale('store-a', { items: [mkItem({ id: 'li-a1', name: 'Case A', price: 5000, qty: 1, cost: 2000 })], subtotal: 5000, salesTax: 450, total: 5450, employeeName: 'Ana' }),
      mkSale('store-a', { items: [mkItem({ name: 'H2O - 111', category: 'phone_payment' as SaleItem['category'], price: 3000, qty: 1, carrier: 'H2O', ...( { commissionRate: 0.10 } as Partial<SaleItem>) })], subtotal: 3000, total: 3000, employeeName: 'Ana' }),
      // Store B: bigger sale + activation + a voided sale + employee Beto.
      mkSale('store-b', { items: [mkItem({ id: 'li-b1', name: 'Case B', price: 20000, qty: 1, cost: 8000 })], subtotal: 20000, salesTax: 1800, total: 21800, employeeName: 'Beto' }),
      mkSale('store-b', { items: [mkItem({ name: 'Verizon Plan', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', isActivation: true, ...( { commissionRate: 0.10 } as Partial<SaleItem>) })], subtotal: 6000, total: 6000, employeeName: 'Beto' }),
      mkSale('store-b', { items: [mkItem({ name: 'Void B', price: 999, qty: 1 })], subtotal: 999, total: 999, status: 'voided' as Sale['status'] }),
      // B: refunded original + its return (today) — must not touch A.
      mkSale('store-b', { id: 'b-ref', items: [mkItem({ id: 'li-bref', name: 'Ref B', price: 4000, qty: 1, cost: 1500 })], subtotal: 4000, total: 4000, status: 'refunded' as Sale['status'] }),
      // B: exchange replacement sale.
      mkSale('store-b', {
        id: 'b-repl',
        items: [
          mkItem({ name: 'Better B', price: 8000, qty: 1, cost: 3000 }),
          mkItem({ name: 'Exchange Credit', category: 'exchange_credit' as SaleItem['category'], price: -5000, qty: 1, taxable: false }),
        ],
        subtotal: 3000, total: 3000,
      }),
      // Legacy sale WITHOUT storeId (established policy: visible in EVERY store).
      mkSale(undefined, { items: [mkItem({ name: 'Legacy', price: 700, qty: 1, cost: 0 })], subtotal: 700, total: 700 }),
    ],
    repairs: [
      { id: 'RB', storeId: 'store-b', status: 'completed', balance: 0, total: 12000, parts: [{ cost: 3000, qty: 1 }], laborCost: 2000, createdAt: AT('10:00:00') } as unknown as Repair,
    ],
    unlocks: [
      { id: 'UB', storeId: 'store-b', status: 'completed', price: 4000, cost: 1500, createdAt: AT('10:30:00') } as unknown as Unlock,
    ],
    specialOrders: [], layaways: [],
    inventory: [
      // Same-named item with DIFFERENT costs per store — the cost fallback
      // must never cross the boundary.
      { id: 'inv-a', storeId: 'store-a', name: 'Mystery', cost: 100 } as unknown as InventoryItem,
      { id: 'inv-b', storeId: 'store-b', name: 'Mystery', cost: 9900 } as unknown as InventoryItem,
    ],
    customerReturns: [
      mkReturn('store-b', {
        originalSaleId: 'b-ref', originalInvoice: 'INV-B-REF',
        items: [{ id: 'li-bref', name: 'Ref B', qty: 1, priceCents: 4000, subtotalCents: 4000, taxCents: 0, totalCents: 4000 }] as CustomerReturn['items'],
        subtotalCents: 4000, totalCents: 4000,
      }),
      mkReturn('store-b', {
        resolution: 'exchange', originalSaleId: 'b-ex-orig', originalInvoice: 'GONE',
        ...( { exchangeSaleId: 'b-repl' } as Partial<CustomerReturn>),
        subtotalCents: 5000, totalCents: 5000,
      }),
      // B: cross-period return (original yesterday, refund today).
      mkReturn('store-b', {
        originalSaleId: 'b-old', originalInvoice: 'INV-B-OLD', createdAt: AT('16:00:00'),
        subtotalCents: 2000, totalCents: 2000,
      }),
    ],
    vendorReturns: [
      { id: 'VRB', storeId: 'store-b', createdAt: AT('11:00:00'), totalValueCents: 700 },
    ],
  };
}

describe('I2A.1 — store-scope policy (the real shared rule)', () => {
  it('belongsToStore: match or legacy no-storeId; isUnscopedView: consolidated/default/empty', () => {
    expect(belongsToStore('store-a', 'store-a')).toBe(true);
    expect(belongsToStore('store-b', 'store-a')).toBe(false);
    expect(belongsToStore(undefined, 'store-a')).toBe(true); // legacy policy
    expect(isUnscopedView('store-a', true)).toBe(true);      // consolidated explicit
    expect(isUnscopedView('default', false)).toBe(true);     // single-store mode
    expect(isUnscopedView('', false)).toBe(true);
    expect(isUnscopedView('store-a', false)).toBe(false);
  });

  it('scopeCollection preserves array identity when unscoped (AppProvider contract)', () => {
    const arr = [{ storeId: 'store-a' }, { storeId: 'store-b' }];
    expect(scopeCollection(arr, 'store-a', true)).toBe(arr);
    expect(scopeCollection(arr, 'default', false)).toBe(arr);
    expect(scopeCollection(arr, 'store-a', false)).not.toBe(arr);
  });
});

describe('I2A.1 — multi-store parity (tests 1-15, 19-22)', () => {
  const G = makeGlobalWorld();
  const A = scopeWorld(G, 'store-a', false);
  const B = scopeWorld(G, 'store-b', false);
  const CONS = scopeWorld(G, 'store-a', true); // consolidated: explicit flag

  it('1/21: single-store A — Intelligence === Reports(A), and B data is absent', () => {
    const canonical = assertScopedParity(A);
    // A = its two sales + the legacy no-storeId sale. Nothing from B.
    expect(canonical.grossSalesCents).toBe(5450 + 3000 + 700);
    expect(canonical.netSalesCents).toBe(9150);
    // 4/5: B's returns (same + cross period) do not reduce A.
    expect(canonical.returnAndRefundAdjustmentsCents).toBe(0);
    // 7/8: B's standalone repair/unlock do not enter A.
    expect(canonical.completedRepairCount).toBe(0);
    expect(canonical.unlockCount).toBe(0);
    // 14: B's voided/refunded counts do not leak into A.
    expect(canonical.voidedCount).toBe(0);
    expect(canonical.refundedCount).toBe(0);
  });

  it('2/22: single-store B — Intelligence === Reports(B), independent of A', () => {
    const canonical = assertScopedParity(B);
    expect(canonical.refundedCount).toBe(1);
    expect(canonical.voidedCount).toBe(1);
    expect(canonical.completedRepairCount).toBe(1);
    // B includes the legacy no-storeId sale too (established policy).
    expect(canonical.grossSalesCents).toBeGreaterThan(0);
  });

  it('3: consolidated === all stores; A+B relation holds for scoped-additive fields', () => {
    const cons = assertScopedParity(CONS);
    const a = canonicalToday(A);
    const b = canonicalToday(B);
    // The legacy no-storeId sale is counted in A, B AND consolidated
    // (established policy) — so consolidated = A + B − legacy (700 gross,
    // 1 tx) which was double-represented in the per-store views.
    expect(cons.grossSalesCents).toBe(a.grossSalesCents + b.grossSalesCents - 700);
    expect(cons.txCount).toBe(a.txCount + b.txCount - 1);
    expect(cons.returnAndRefundAdjustmentsCents).toBe(a.returnAndRefundAdjustmentsCents + b.returnAndRefundAdjustmentsCents);
  });

  it('6: B\'s exchange affects only B (COGS reversal absent from A)', () => {
    const a = canonicalToday(A);
    const b = canonicalToday(B);
    expect(a.exchangeReturnedCostReversalCents).toBe(0);
    expect(a.exchangeCreditCents).toBe(0);
    expect(b.exchangeCreditCents).toBe(5000);
  });

  it('9: B\'s vendor return does not reduce A COGS', () => {
    const a = canonicalToday(A);
    // A COGS = Case A 2000 + phone payment cost — untouched by VRB(700).
    const aNoVR = canonicalToday({ ...A, vendorReturns: [] });
    expect(a.totalCostCents).toBe(aNoVR.totalCostCents);
    const b = canonicalToday(B);
    const bNoVR = canonicalToday({ ...B, vendorReturns: [] });
    expect(b.totalCostCents).toBe(bNoVR.totalCostCents - 700);
  });

  it('10: inventory cost fallback cannot cross stores (same name, different cost)', () => {
    const legacyItem = mkItem({ name: 'Mystery', price: 4000, qty: 1 });
    delete (legacyItem as Partial<SaleItem>).cost;
    const G2: GlobalWorld = {
      ...makeGlobalWorld(),
      sales: [mkSale('store-a', { items: [legacyItem], subtotal: 4000, total: 4000 })],
      customerReturns: [], vendorReturns: [], repairs: [], unlocks: [],
    };
    const a = canonicalToday(scopeWorld(G2, 'store-a', false));
    const b = canonicalToday(scopeWorld(G2, 'store-b', false));
    // A resolves cost from A's inventory (100), never B's 9900.
    expect(a.totalCostCents).toBe(100);
    expect(b.totalCostCents).toBe(0); // sale not visible in B at all
    assertScopedParity(scopeWorld(G2, 'store-a', false));
  });

  it('11/12: provider and activation-carrier totals remain scoped', () => {
    const a = canonicalToday(A);
    const b = canonicalToday(B);
    // A has the H2O bill payment; the Verizon ACTIVATION lives only in B.
    expect(Object.values(a.phonePaymentsByProvider).reduce((s, p) => s + p.totalCents, 0)).toBe(3000);
    expect(Object.keys(a.activationsByCarrier).length).toBe(0);
    expect(Object.keys(b.activationsByCarrier).length).toBeGreaterThan(0);
  });

  it('13: employee performance remains scoped (B names never reach an A viewer)', () => {
    const engineA = buildEngine(A);
    const rows = getEmployeePerformance(engineA.canonicalMoneySnapshot(), 'today');
    const names = rows.map((r) => r.name);
    expect(names).toContain('Ana');
    expect(names).not.toContain('Beto');
  });

  it('15: settings/commission changes flow identically to both paths (global settings policy)', () => {
    const alt: CanonicalMoneySettings = { defaultCommissionRate: 0.20, carrierCommissions: {} };
    const G3: GlobalWorld = {
      ...makeGlobalWorld(),
      sales: [mkSale('store-a', { items: [mkItem({ name: 'Cricket Bill Payment', category: 'phone_payment' as SaleItem['category'], price: 4000, qty: 1 })], subtotal: 4000, total: 4000 })],
      customerReturns: [], vendorReturns: [], repairs: [], unlocks: [],
    };
    const A3 = scopeWorld(G3, 'store-a', false);
    const base = assertScopedParity(A3, SETTINGS);
    const changed = assertScopedParity(A3, alt);
    expect(changed.totalProfitCents).not.toBe(base.totalProfitCents);
  });

  it('19: legacy no-storeId records follow the established policy (visible in A, B and consolidated)', () => {
    const a = canonicalToday(A);
    const b = canonicalToday(B);
    const cons = canonicalToday(CONS);
    // The 700-cent legacy sale is present in all three views.
    for (const stats of [a, b, cons]) {
      expect(stats.topItems.some((t) => t.name === 'Legacy')).toBe(true);
    }
  });

  it('20: inputs remain immutable through scoping + both paths', () => {
    const snapshot = JSON.stringify(G.sales);
    assertScopedParity(A);
    assertScopedParity(B);
    assertScopedParity(CONS);
    expect(JSON.stringify(G.sales)).toBe(snapshot);
  });
});

describe('I2A.1 — store switching and cache safety (tests 16-18)', () => {
  const G = makeGlobalWorld();
  const A = scopeWorld(G, 'store-a', false);
  const B = scopeWorld(G, 'store-b', false);
  const CONS = scopeWorld(G, 'store-a', true);

  it('16/17: A → B → consolidated via updateData refreshes getTodayMetrics immediately', () => {
    const engine = buildEngine(A);
    const mA = engine.getTodayMetrics();
    expect(mA.netSalesCents).toBe(canonicalToday(A).netSalesCents);

    engine.updateData(B.sales, [], B.inventory, B.repairs, {
      specialOrders: B.specialOrders, unlocks: B.unlocks, layaways: B.layaways,
      customerReturns: B.customerReturns, vendorReturns: B.vendorReturns, settings: SETTINGS,
    });
    const mB = engine.getTodayMetrics();
    expect(mB.netSalesCents).toBe(canonicalToday(B).netSalesCents);
    expect(mB.netSalesCents).not.toBe(mA.netSalesCents);

    engine.updateData(CONS.sales, [], CONS.inventory, CONS.repairs, {
      specialOrders: CONS.specialOrders, unlocks: CONS.unlocks, layaways: CONS.layaways,
      customerReturns: CONS.customerReturns, vendorReturns: CONS.vendorReturns, settings: SETTINGS,
    });
    const mC = engine.getTodayMetrics();
    expect(mC.netSalesCents).toBe(canonicalToday(CONS).netSalesCents);
    // (In the app, changing currentStoreId/consolidatedView ALSO rebuilds the
    // engine via engineConfigSig — this test covers the updateData path.)
  });

  it('18: same-length arrays with different store contents never leave stale results', () => {
    const saleA = mkSale('store-a', { items: [mkItem({ name: 'OnlyA', price: 1111, qty: 1, cost: 0 })], subtotal: 1111, total: 1111 });
    const saleB = mkSale('store-b', { items: [mkItem({ name: 'OnlyB', price: 2222, qty: 1, cost: 0 })], subtotal: 2222, total: 2222 });
    const worldA: GlobalWorld = { sales: [saleA], repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [] };
    const worldB: GlobalWorld = { ...worldA, sales: [saleB] }; // SAME length, different store
    const engine = buildEngine(worldA);
    expect(engine.getTodayMetrics().netSalesCents).toBe(1111);
    engine.updateData(worldB.sales, [], [], [], { vendorReturns: [], settings: SETTINGS });
    expect(engine.getTodayMetrics().netSalesCents).toBe(2222); // no stale 1111
  });
});
