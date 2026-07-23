// ============================================================
// P0-SC-1 — buildSale item-field preservation tests
//
// Root-cause regression lock: buildSale maps cart lines to SaleItems with an
// EXPLICIT field list. Fields missing from that list are silently dropped at
// checkout — that is exactly how the store-credit double-spend happened
// (storeCreditLedgerId never reached the Sale, so §4e never debited the
// certificate). These tests pin the identity fields that money-side
// post-processing depends on.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { CartItem, StoreSettings } from '@/store/types';
import type { CartTotals } from './types';
import { buildSale, computePaidCents } from './saleBuilder';

const settings = { invoicePrefix: 'INV' } as unknown as StoreSettings;

function totals(over: Partial<CartTotals> = {}): CartTotals {
  return {
    subtotal: 0, discountAmount: 0, manualDiscount: 0, loyaltyDiscount: 0,
    subtotalAfterDiscount: 0, salesTax: 0, utilityTax: 0, mobileSurcharge: 0,
    creditCardFee: 0, cbeFee: 0, screenFee: 0, total: 0,
    ...over,
  };
}

function cartItem(over: Partial<CartItem> = {}): CartItem {
  return {
    id: 'ci1', name: 'X', category: 'accessory', price: 1000, qty: 1,
    taxable: false, cbeEligible: false,
    ...over,
  } as CartItem;
}

describe('buildSale — store-credit identity fields survive checkout (P0-SC-1)', () => {
  it('preserves storeCreditLedgerId + storeCreditCertNumber on the sale item', () => {
    const creditLine = cartItem({
      id: 'sc-line', category: 'exchange_credit', price: -6300, qty: 1,
      storeCreditLedgerId: 'ledger-1', storeCreditCertNumber: 'SC-12345678-ABCD',
    });
    const sale = buildSale({
      cart: [cartItem(), creditLine],
      totals: totals({ subtotal: 1000, subtotalAfterDiscount: 1000, total: 0 }),
      paymentMethod: 'Cash', cashAmount: 0, cardAmount: 0,
      selectedCustomer: null, currentEmployee: null, settings,
    });
    const saved = sale.items.find((i) => i.id === 'sc-line')!;
    expect(saved.storeCreditLedgerId).toBe('ledger-1');
    expect(saved.storeCreditCertNumber).toBe('SC-12345678-ABCD');
    expect(saved.price).toBe(-6300);
  });

  it('keeps the other post-sale identity fields intact (regression lock)', () => {
    const line = cartItem({
      category: 'phone_payment', carrier: 'Verizon', phoneNumber: '8055551234',
      workflowId: 'wf-9', repairId: 'r1', specialOrderId: 'so1', unlockId: 'u1', layawayId: 'l1',
    });
    const sale = buildSale({
      cart: [line], totals: totals({ total: 1000 }),
      paymentMethod: 'Cash', cashAmount: 10, cardAmount: 0,
      selectedCustomer: null, currentEmployee: null, settings,
    });
    const it0 = sale.items[0];
    expect(it0.workflowId).toBe('wf-9');
    expect(it0.repairId).toBe('r1');
    expect(it0.specialOrderId).toBe('so1');
    expect(it0.unlockId).toBe('u1');
    expect(it0.layawayId).toBe('l1');
    expect(it0.carrier).toBe('Verizon');
  });

  it('lines without store-credit identity stay clean (no phantom fields)', () => {
    const sale = buildSale({
      cart: [cartItem()], totals: totals({ total: 1000 }),
      paymentMethod: 'Cash', cashAmount: 10, cardAmount: 0,
      selectedCustomer: null, currentEmployee: null, settings,
    });
    expect(sale.items[0].storeCreditLedgerId).toBeUndefined();
    expect(sale.items[0].storeCreditCertNumber).toBeUndefined();
  });
});

describe('computePaidCents — Store Credit tender guard input', () => {
  it('caps Store Credit payment at the available balance', () => {
    expect(computePaidCents('Store Credit', 0, 0, 23270, 6300)).toBe(6300);  // enough credit
    expect(computePaidCents('Store Credit', 0, 0, 5000, 6300)).toBe(5000);   // short → caller blocks
    expect(computePaidCents('Store Credit', 0, 0, 0, 6300)).toBe(0);         // no customer/credit → blocked
  });
});
