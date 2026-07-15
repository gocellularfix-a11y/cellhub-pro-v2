// R-2.1.4-REPORTS-ACTIVATION-CLASSIFICATION-V1 — regression tests.
// Locks the semantic split between Phone Payments (by provider) and genuine
// Activations (by carrier): a bill payment must NEVER count as an activation
// merely because it carries a carrier name, and vice versa.
import { describe, it, expect } from 'vitest';
import type { Sale, SaleItem } from '@/store/types';
import {
  classifyItem,
  isActivationSaleItem,
  normalizeCarrierName,
  lineRevenueCents,
  computePhonePaymentEconomics,
  aggregatePhoneActivity,
  buildActivationsByCarrierPrintModel,
  reportCategoryOverride,
  ACTIVATIONS_CATEGORY,
} from './phonePaymentReporting';
import { getActivePortals } from '@/config/paymentPortals';

const SETTINGS = {
  carrierCommissions: { 'Page Plus': 0.08, 'AT&T': 0.10, 'H2O': 0.09 } as Record<string, number>,
  defaultCommissionRate: 0.07,
};
const PORTALS = getActivePortals({});
const LABELS = { noProvider: '(No provider)', noCarrier: '(No carrier)' };

let itemSeq = 0;
function makeItem(overrides: Partial<SaleItem> & Record<string, unknown>): SaleItem {
  return {
    id: `item-${++itemSeq}`,
    name: 'Item',
    price: 0,
    qty: 1,
    ...overrides,
  } as unknown as SaleItem;
}

function makeSale(id: string, items: SaleItem[], overrides: Record<string, unknown> = {}): Sale {
  return {
    id,
    invoiceNumber: `INV-${id}`,
    createdAt: '2026-07-10T10:15:00',
    items,
    total: items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0),
    status: 'completed',
    ...overrides,
  } as unknown as Sale;
}

function billPayment(carrier: string, phone: string, priceCents: number, portal = 'VidaPay'): SaleItem {
  return makeItem({
    name: `${carrier} - ${phone}`,
    category: 'phone_payment',
    price: priceCents,
    carrier,
    phoneNumber: phone,
    portal,
    commissionRate: 0.08,
  });
}

function run(sales: Sale[]) {
  return aggregatePhoneActivity(sales, SETTINGS, PORTALS, {}, LABELS);
}

describe('classification primitives', () => {
  it('detects genuine activation lines by semantic markers only', () => {
    expect(isActivationSaleItem(makeItem({ category: 'activation' }))).toBe(true);
    expect(isActivationSaleItem(makeItem({ category: 'sim' }))).toBe(true);
    expect(isActivationSaleItem(makeItem({ category: 'phone_payment', isActivation: true }))).toBe(true);
    // A bill payment with a carrier name is NOT an activation:
    expect(isActivationSaleItem(billPayment('Page Plus', '8055550001', 3000))).toBe(false);
  });

  it('classifyItem keeps phone_payment detection for legacy and v2 shapes', () => {
    expect(classifyItem(billPayment('H2O', '8055550002', 3500))).toBe('phone_payment');
    expect(classifyItem(makeItem({ type: 'phone_payment' }))).toBe('phone_payment');
    expect(classifyItem(makeItem({ category: 'activation' }))).toBe('product');
  });

  it('normalizeCarrierName canonicalizes known carriers', () => {
    expect(normalizeCarrierName('page plus')).toBe('Page Plus');
    expect(normalizeCarrierName('att')).toBe('AT&T');
    expect(normalizeCarrierName('h2o wireless')).toBe('H2O');
  });
});

describe('scenario 1 — Page Plus phone payment, zero Page Plus activations', () => {
  it('appears ONLY in Phone Payments, never in Activations by Carrier', () => {
    const { phonePaymentsByProvider, activationsByCarrier } = run([
      makeSale('s1', [billPayment('Page Plus', '8055550003', 3000)]),
    ]);
    expect(phonePaymentsByProvider['VidaPay']).toBeDefined();
    expect(phonePaymentsByProvider['VidaPay'].count).toBe(1);
    expect(phonePaymentsByProvider['VidaPay'].totalCents).toBe(3000);
    expect(Object.keys(activationsByCarrier)).toHaveLength(0);
  });
});

describe('scenario 2 — multiple carriers through the same provider', () => {
  it('keeps the provider summary correct and each detail row shows its actual carrier', () => {
    const { phonePaymentsByProvider } = run([
      makeSale('s1', [
        billPayment('Page Plus', '8055550004', 3000, 'VidaPay'),
        billPayment('H2O', '8055550005', 4500, 'VidaPay'),
      ]),
    ]);
    const vp = phonePaymentsByProvider['VidaPay'];
    expect(vp.count).toBe(2);
    expect(vp.totalCents).toBe(7500);
    expect(vp.details.map((d) => d.carrier).sort()).toEqual(['H2O', 'Page Plus']);
  });
});

describe('scenario 3 — one genuine activation', () => {
  const activationSale = makeSale('act1', [
    // Plan line: category phone_payment BUT isActivation — the exact shape
    // PhonePaymentModal's Activation tab creates.
    makeItem({ name: '📱 Plan AT&T — Unlimited', category: 'phone_payment', isActivation: true, price: 5000, carrier: 'AT&T', phoneNumber: '8055550006', commissionRate: 0.10 }),
    makeItem({ name: '⚡ Activation Fee AT&T', category: 'activation', isActivation: true, price: 2500, carrier: 'AT&T', phoneNumber: '8055550006' }),
  ]);

  it('appears in Activations by Carrier (once) and NOT as a phone payment', () => {
    const { phonePaymentsByProvider, activationsByCarrier } = run([activationSale]);
    expect(Object.keys(phonePaymentsByProvider)).toHaveLength(0);
    const att = activationsByCarrier['AT&T'];
    expect(att).toBeDefined();
    // Plan + fee share sale + phone → ONE activation event:
    expect(att.count).toBe(1);
    expect(att.totalCents).toBe(7500);
    // Plan profit = 5000 - round(5000*0.90) = 500; fee = 100% profit = 2500.
    expect(att.profitCents).toBe(500 + 2500);
    expect(att.numbers.has('8055550006')).toBe(true);
  });

  it('two-line activation in one sale counts one event per activated phone line', () => {
    const twoLines = makeSale('act2', [
      makeItem({ name: '📱 Plan AT&T', category: 'phone_payment', isActivation: true, price: 5000, carrier: 'AT&T', phoneNumber: '8055550007', commissionRate: 0.10 }),
      makeItem({ name: '📱 Plan AT&T', category: 'phone_payment', isActivation: true, price: 5000, carrier: 'AT&T', phoneNumber: '8055550008', commissionRate: 0.10 }),
    ]);
    const { activationsByCarrier } = run([twoLines]);
    expect(activationsByCarrier['AT&T'].count).toBe(2);
  });

  it('never double-counts a line as both payment and activation, but separate legit lines both count', () => {
    const mixed = makeSale('mix1', [
      billPayment('H2O', '8055550009', 3000, 'H2O'),
      makeItem({ name: '⚡ Activation Fee AT&T', category: 'activation', isActivation: true, price: 2500, carrier: 'AT&T', phoneNumber: '8055550010' }),
    ]);
    const { phonePaymentsByProvider, activationsByCarrier } = run([mixed]);
    expect(phonePaymentsByProvider['H2O'].count).toBe(1);
    expect(phonePaymentsByProvider['H2O'].totalCents).toBe(3000);
    expect(activationsByCarrier['AT&T'].count).toBe(1);
    expect(activationsByCarrier['AT&T'].totalCents).toBe(2500);
    // No leakage either way:
    expect(activationsByCarrier['H2O']).toBeUndefined();
    expect(Object.keys(phonePaymentsByProvider)).toHaveLength(1);
  });
});

describe('scenario 4 — repeated payments for the same phone number', () => {
  it('keeps every transaction visible and counts/totals include all of them', () => {
    const { phonePaymentsByProvider } = run([
      makeSale('s1', [billPayment('H2O', '8055550011', 3000, 'H2O')]),
      makeSale('s2', [billPayment('H2O', '8055550011', 3000, 'H2O')]),
    ]);
    const h2o = phonePaymentsByProvider['H2O'];
    expect(h2o.count).toBe(2);
    expect(h2o.totalCents).toBe(6000);
    expect(h2o.details).toHaveLength(2);
    // Unique-number display set still dedups (existing behavior):
    expect(h2o.numbers.size).toBe(1);
  });
});

describe('scenario 5 — historical payment missing phone or carrier', () => {
  it('is included with empty fields (renderers show "Not recorded") and totals stay correct', () => {
    const legacy = makeItem({ name: 'Bill payment', category: 'phone_payment', price: 2000, portal: 'QPay', commissionRate: 0.07 });
    const { phonePaymentsByProvider } = run([makeSale('s1', [legacy])]);
    const qp = phonePaymentsByProvider['QPay'];
    expect(qp.count).toBe(1);
    expect(qp.totalCents).toBe(2000);
    expect(qp.details).toHaveLength(1);
    expect(qp.details[0].phoneNumber).toBe('');
    expect(qp.details[0].carrier).toBe('');
  });

  it('derives a KNOWN carrier from legacy item names, but never junk from free text', () => {
    const legacyKnown = makeItem({ name: 'H2O Wireless 25', category: 'phone_payment', price: 2500, portal: 'H2O', commissionRate: 0.09 });
    const { phonePaymentsByProvider } = run([makeSale('s1', [legacyKnown])]);
    expect(phonePaymentsByProvider['H2O'].details[0].carrier).toBe('H2O');
  });

  it('missing portal AND carrier falls back to the no-provider label, still counted', () => {
    const legacy = makeItem({ name: 'Bill payment', category: 'phone_payment', price: 2000, commissionRate: 0.07 });
    const { phonePaymentsByProvider } = run([makeSale('s1', [legacy])]);
    expect(phonePaymentsByProvider[LABELS.noProvider].count).toBe(1);
    expect(phonePaymentsByProvider[LABELS.noProvider].totalCents).toBe(2000);
  });
});

describe('scenario 6 — provider summary reconciliation (exact integer cents)', () => {
  it('summary count/total/profit equal the exact sums of the detail rows', () => {
    const { phonePaymentsByProvider } = run([
      makeSale('s1', [
        billPayment('Page Plus', '8055550012', 3001, 'VidaPay'),
        billPayment('H2O', '8055550013', 4499, 'VidaPay'),
      ]),
      makeSale('s2', [billPayment('H2O', '8055550013', 1250, 'VidaPay')]),
    ]);
    for (const bucket of Object.values(phonePaymentsByProvider)) {
      expect(bucket.count).toBe(bucket.details.length);
      expect(bucket.totalCents).toBe(bucket.details.reduce((s, d) => s + d.amountCents, 0));
      expect(bucket.profitCents).toBe(bucket.details.reduce((s, d) => s + d.profitCents, 0));
      expect(Number.isInteger(bucket.totalCents)).toBe(true);
      expect(Number.isInteger(bucket.profitCents)).toBe(true);
    }
  });
});

describe('scenario 7 — screen and printed report share one dataset', () => {
  it('aggregation is deterministic: same input produces identical buckets (single source for screen + print + export)', () => {
    const sales = [
      makeSale('s1', [billPayment('Page Plus', '8055550014', 3000, 'VidaPay')]),
      makeSale('s2', [
        makeItem({ name: '📱 Plan AT&T', category: 'phone_payment', isActivation: true, price: 5000, carrier: 'AT&T', phoneNumber: '8055550015', commissionRate: 0.10 }),
      ]),
    ];
    const a = run(sales);
    const b = run(sales);
    expect(JSON.stringify(a, (_k, v) => (v instanceof Set ? Array.from(v) : v)))
      .toBe(JSON.stringify(b, (_k, v) => (v instanceof Set ? Array.from(v) : v)));
  });
});

describe('economics parity with the category loop', () => {
  it('computePhonePaymentEconomics matches the stamped-rate contract', () => {
    const item = billPayment('Page Plus', '8055550016', 3000);
    const eco = computePhonePaymentEconomics(item, SETTINGS);
    expect(eco.revenueCents).toBe(lineRevenueCents(item));
    expect(eco.costCents).toBe(Math.round(3000 * (1 - 0.08)));
    expect(eco.profitCents).toBe(3000 - eco.costCents);
    expect(eco.normalizedCarrier).toBe('Page Plus');
  });

  it('falls back to carrier commission table, then default rate', () => {
    const noRate = makeItem({ name: 'AT&T Bill Payment', category: 'phone_payment', price: 1000, carrier: 'AT&T' });
    expect(computePhonePaymentEconomics(noRate, SETTINGS).commRate).toBe(0.10);
    const unknown = makeItem({ name: 'Mystery Bill Payment', category: 'phone_payment', price: 1000, carrier: 'Nowhere Mobile' });
    expect(computePhonePaymentEconomics(unknown, SETTINGS).commRate).toBe(0.07);
  });
});

// ══════════════════════════════════════════════════════════════
// R-2.1.4-PRINT-PAGES Phase 4 — printed Activations by Carrier
// ══════════════════════════════════════════════════════════════

function activationLine(carrier: string, phone: string, planCents: number, feeCents: number): SaleItem[] {
  const items: SaleItem[] = [
    makeItem({ name: `📱 Plan ${carrier}`, category: 'phone_payment', isActivation: true, price: planCents, carrier, phoneNumber: phone, commissionRate: 0.10 }),
  ];
  if (feeCents > 0) {
    items.push(makeItem({ name: `⚡ Activation Fee ${carrier}`, category: 'activation', isActivation: true, price: feeCents, carrier, phoneNumber: phone }));
  }
  return items;
}

describe('printed Activations by Carrier — parity with the screen aggregation', () => {
  const sales = [
    makeSale('a1', activationLine('Verizon', '8055550101', 5000, 2500)),
    makeSale('a2', activationLine('AT&T', '8055550102', 4000, 0)),
    makeSale('p1', [billPayment('Page Plus', '8055550103', 3000, 'VidaPay')]),
  ];

  it('the print model is a pure projection of the SAME buckets the screen card renders', () => {
    const { activationsByCarrier } = run(sales);
    const model = buildActivationsByCarrierPrintModel(activationsByCarrier);
    // Same carriers, same counts, same exact cent totals as the screen data:
    expect(model.rows.map((r) => r.carrier).sort()).toEqual(Object.keys(activationsByCarrier).sort());
    for (const row of model.rows) {
      const bucket = activationsByCarrier[row.carrier];
      expect(row.count).toBe(bucket.count);
      expect(row.totalCents).toBe(bucket.totalCents);
      expect(row.profitCents).toBe(bucket.profitCents);
      expect(row.uniqueNumbers).toBe(bucket.numbers.size);
    }
    // Totals reconcile exactly in integer cents:
    expect(model.totals.totalCents).toBe(model.rows.reduce((s, r) => s + r.totalCents, 0));
    expect(model.totals.profitCents).toBe(model.rows.reduce((s, r) => s + r.profitCents, 0));
    expect(Number.isInteger(model.totals.totalCents)).toBe(true);
  });

  it('payment records are excluded; genuine activations included; sorted by total desc', () => {
    const { activationsByCarrier } = run(sales);
    const model = buildActivationsByCarrierPrintModel(activationsByCarrier);
    expect(model.rows.map((r) => r.carrier)).toEqual(['Verizon', 'AT&T']); // 7500 > 4000
    expect(model.rows.find((r) => r.carrier === 'Page Plus')).toBeUndefined();
    expect(model.totals.count).toBe(2);
  });

  it('missing activation carrier flows through as the no-carrier bucket (rendered "Not recorded")', () => {
    const noCarrier = makeSale('a3', [
      makeItem({ name: '⚡ Activation Fee', category: 'activation', isActivation: true, price: 2000, phoneNumber: '8055550104' }),
    ]);
    const { activationsByCarrier } = run([noCarrier]);
    const model = buildActivationsByCarrierPrintModel(activationsByCarrier);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].carrier).toBe(LABELS.noCarrier);
    expect(model.rows[0].totalCents).toBe(2000);
  });

  it('margin comes from exact cents; profit values are integers (role privacy is a render concern, data stays exact)', () => {
    const { activationsByCarrier } = run(sales);
    const model = buildActivationsByCarrierPrintModel(activationsByCarrier);
    for (const row of model.rows) {
      expect(Number.isInteger(row.profitCents)).toBe(true);
      expect(row.marginPct).toBeCloseTo((row.profitCents / row.totalCents) * 100, 10);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// R-2.1.4 Phase 5 — deterministic fixture reproducing the exact
// production screenshot: 26 phone payments / $1,063.00 total.
// ══════════════════════════════════════════════════════════════

function paymentsFixture(): Sale[] {
  const sales: Sale[] = [];
  let n = 0;
  const add = (carrier: string, portal: string, amounts: number[]) => {
    for (const cents of amounts) {
      n++;
      sales.push(makeSale(`fx${n}`, [billPayment(carrier, `80555512${String(n).padStart(2, '0')}`, cents, portal)]));
    }
  };
  // Page Plus: 1 / $30 — via VidaPay
  add('Page Plus', 'VidaPay', [3000]);
  // Simple Mobile: 5 / $200 — via VidaPay (VidaPay total: 6 / $230)
  add('Simple Mobile', 'VidaPay', [4000, 4000, 4000, 4000, 4000]);
  // H2O: 9 / $230 — via H2O portal
  add('H2O', 'H2O', [2500, 2500, 2500, 2500, 2500, 2500, 2500, 3000, 2500]);
  // Verizon: 6 / $310 — via WebPOS
  add('Verizon', 'WebPOS', [5000, 5000, 5000, 5000, 5000, 6000]);
  // AT&T: 5 / $293 — via QPay
  add('AT&T', 'QPay', [6000, 6000, 6000, 6000, 5300]);
  return sales;
}

describe('exact 26/$1,063 production-screenshot fixture', () => {
  it('reproduces the provider table exactly and reports ZERO activations', () => {
    const { phonePaymentsByProvider, activationsByCarrier } = run(paymentsFixture());

    const summary = Object.fromEntries(Object.entries(phonePaymentsByProvider)
      .map(([k, v]) => [k, { count: v.count, totalCents: v.totalCents }]));
    expect(summary).toEqual({
      'VidaPay': { count: 6, totalCents: 23000 },
      'H2O':     { count: 9, totalCents: 23000 },
      'WebPOS':  { count: 6, totalCents: 31000 },
      'QPay':    { count: 5, totalCents: 29300 },
    });
    const totalCount = Object.values(phonePaymentsByProvider).reduce((s, v) => s + v.count, 0);
    const totalCents = Object.values(phonePaymentsByProvider).reduce((s, v) => s + v.totalCents, 0);
    expect(totalCount).toBe(26);
    expect(totalCents).toBe(106300); // $1,063.00 exactly

    // THE FIX UNDER TEST: none of these 26 payments is an activation.
    // (Previously this same dataset re-grouped by carrier WAS the
    // "Activations by Carrier" card: H2O 9/$230, Verizon 6/$310,
    // Simple Mobile 5/$200, AT&T 5/$293, Page Plus 1/$30.)
    expect(Object.keys(activationsByCarrier)).toHaveLength(0);
    const printModel = buildActivationsByCarrierPrintModel(activationsByCarrier);
    expect(printModel.rows).toHaveLength(0);
  });

  it('26 provider detail rows reconcile exactly; Page Plus $30 appears ONLY as a payment', () => {
    const { phonePaymentsByProvider } = run(paymentsFixture());
    let detailRows = 0;
    for (const bucket of Object.values(phonePaymentsByProvider)) {
      detailRows += bucket.details.length;
      expect(bucket.count).toBe(bucket.details.length);
      expect(bucket.totalCents).toBe(bucket.details.reduce((s, d) => s + d.amountCents, 0));
      expect(bucket.profitCents).toBe(bucket.details.reduce((s, d) => s + d.profitCents, 0));
    }
    expect(detailRows).toBe(26);
    const pagePlus = phonePaymentsByProvider['VidaPay'].details.filter((d) => d.carrier === 'Page Plus');
    expect(pagePlus).toHaveLength(1);
    expect(pagePlus[0].amountCents).toBe(3000);
    // No duplicate transaction references:
    const ids = Object.values(phonePaymentsByProvider).flatMap((b) => b.details.map((d) => `${d.saleId}`));
    expect(new Set(ids).size).toBe(26);
  });

  it('adding one genuine activation does not disturb the 26/$1,063 payments', () => {
    const sales = [...paymentsFixture(), makeSale('act-fx', activationLine('Verizon', '8055559999', 5000, 2500))];
    const { phonePaymentsByProvider, activationsByCarrier } = run(sales);
    const totalCents = Object.values(phonePaymentsByProvider).reduce((s, v) => s + v.totalCents, 0);
    const totalCount = Object.values(phonePaymentsByProvider).reduce((s, v) => s + v.count, 0);
    expect(totalCount).toBe(26);
    expect(totalCents).toBe(106300);
    expect(activationsByCarrier['Verizon'].count).toBe(1);
    expect(activationsByCarrier['Verizon'].totalCents).toBe(7500);
  });

  it('category re-bucketing never changes money: item revenue is identical whichever bucket a line lands in', () => {
    // Gross/net/profit/tax/tender totals are sums over ITEMS/SALES, not over
    // category labels — the override returns a LABEL only. Lock that shape:
    const plan = makeItem({ name: '📱 Plan AT&T', category: 'phone_payment', isActivation: true, price: 5000, carrier: 'AT&T', commissionRate: 0.10 });
    const before = computePhonePaymentEconomics(plan, SETTINGS);
    expect(reportCategoryOverride(plan)).toBe(ACTIVATIONS_CATEGORY);
    const after = computePhonePaymentEconomics(plan, SETTINGS); // unchanged by the override
    expect(after).toEqual(before);
  });

  it('screen, print and export views consume the identical aggregation (single source)', () => {
    const agg1 = run(paymentsFixture());
    const agg2 = run(paymentsFixture());
    const serialize = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Set ? Array.from(x).sort() : x));
    expect(serialize(agg1)).toBe(serialize(agg2));
    // The print model is derived (not re-classified) from the same buckets:
    expect(serialize(buildActivationsByCarrierPrintModel(agg1.activationsByCarrier)))
      .toBe(serialize(buildActivationsByCarrierPrintModel(agg2.activationsByCarrier)));
  });
});

// ══════════════════════════════════════════════════════════════
// R-2.1.4-CLOSEOUT — Sales by Category classification
// ══════════════════════════════════════════════════════════════

describe('Sales by Category — activation-flow lines never bucket as Phone Payments', () => {
  it('ordinary bill payments stay under Phone Payments (no override)', () => {
    expect(reportCategoryOverride(billPayment('Page Plus', '8055550300', 3000))).toBeNull();
    expect(reportCategoryOverride(billPayment('H2O', '8055550301', 2500))).toBeNull();
  });

  it('activation plan / fee / SIM lines all bucket under the Activations category', () => {
    const plan = makeItem({ name: '📱 Plan Verizon', category: 'phone_payment', isActivation: true, price: 5000, carrier: 'Verizon' });
    const fee = makeItem({ name: '⚡ Activation Fee Verizon', category: 'activation', price: 2500, carrier: 'Verizon' });
    const sim = makeItem({ name: '📶 SIM — Verizon', category: 'sim', price: 1500, carrier: 'Verizon' });
    expect(reportCategoryOverride(plan)).toBe(ACTIVATIONS_CATEGORY);
    expect(reportCategoryOverride(fee)).toBe(ACTIVATIONS_CATEGORY);
    expect(reportCategoryOverride(sim)).toBe(ACTIVATIONS_CATEGORY);
    expect(ACTIVATIONS_CATEGORY).toBe('Activations');
  });

  it('a line lands in exactly ONE bucket — no double-counting is structurally possible', () => {
    // The override is a single label replacement inside the same loop pass:
    // one item → one catName. Assert exclusivity of the decision function:
    const plan = makeItem({ name: '📱 Plan AT&T', category: 'phone_payment', isActivation: true, price: 5000 });
    const bill = billPayment('AT&T', '8055550302', 5000);
    expect(reportCategoryOverride(plan)).toBe(ACTIVATIONS_CATEGORY);
    expect(reportCategoryOverride(bill)).toBeNull();
  });

  it('one activation (plan + fee + SIM): category revenue equals the exact integer-cent sum of its lines', () => {
    const lines = [
      makeItem({ name: '📱 Plan Verizon', category: 'phone_payment', isActivation: true, price: 5001, carrier: 'Verizon', commissionRate: 0.10 }),
      makeItem({ name: '⚡ Activation Fee Verizon', category: 'activation', isActivation: true, price: 2499, carrier: 'Verizon' }),
      makeItem({ name: '📶 SIM — Verizon', category: 'sim', price: 1500, carrier: 'Verizon', cost: 200 }),
    ];
    // Every line classifies as Activations; the category bucket accumulates
    // lineRevenueCents per line — 3 category LINES, exact cents:
    const categoryRevenue = lines
      .filter((l) => reportCategoryOverride(l) === ACTIVATIONS_CATEGORY)
      .reduce((s, l) => s + lineRevenueCents(l), 0);
    expect(lines.every((l) => reportCategoryOverride(l) === ACTIVATIONS_CATEGORY)).toBe(true);
    expect(categoryRevenue).toBe(5001 + 2499 + 1500);
    // …while the Activations-by-Carrier card still counts ONE event (dedup
    // by sale+phone is untouched):
    const { activationsByCarrier } = run([makeSale('cat1', lines.map((l) => ({ ...l, phoneNumber: '8055550303' } as SaleItem)))]);
    expect(activationsByCarrier['Verizon'].count).toBe(1);
    expect(activationsByCarrier['Verizon'].totalCents).toBe(9000);
  });

  it('the exact 26/$1,063 fixture keeps Phone Payments at 26/$1,063 with ZERO activation-category lines', () => {
    const sales = paymentsFixture();
    let ppRevenue = 0;
    let ppCount = 0;
    let actLines = 0;
    for (const sale of sales) {
      for (const item of (sale.items || [])) {
        if (reportCategoryOverride(item)) { actLines++; continue; }
        if (classifyItem(item) === 'phone_payment') { ppCount++; ppRevenue += lineRevenueCents(item); }
      }
    }
    expect(ppCount).toBe(26);
    expect(ppRevenue).toBe(106300);
    expect(actLines).toBe(0);
  });
});
