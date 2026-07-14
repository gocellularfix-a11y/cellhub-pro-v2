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
