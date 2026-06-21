// ============================================================
// R-RETURNS-NEGATIVE-CART-CALC-FIX (Phase 1) — calculateCartTotals tests.
//
// Locks the net-negative cart (exchange credit > replacement) calculation and
// proves normal positive sales are unchanged. Money is cents-as-integer.
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateCartTotals } from './types';
import type { DiscountState } from './types';
import type { CartItem, StoreSettings } from '@/store/types';

const SETTINGS = { taxRate: 0.0925 } as unknown as StoreSettings;
const NO_DISCOUNT: DiscountState = { amount: 0, type: 'percent', reason: '' } as DiscountState;

function item(partial: Partial<CartItem>): CartItem {
  return {
    id: partial.id || 'i1',
    name: partial.name || 'Item',
    category: partial.category || 'accessory',
    price: partial.price ?? 0,   // cents
    qty: partial.qty ?? 1,
    taxable: partial.taxable ?? false,
  } as unknown as CartItem;
}

describe('calculateCartTotals — negative-cart fix (Phase 1)', () => {
  it('1. normal positive taxable sale is unchanged', () => {
    const cart = [item({ price: 7900, qty: 1, taxable: true })];
    const t = calculateCartTotals(cart, SETTINGS, NO_DISCOUNT, 'Cash', false);
    expect(t.subtotal).toBe(7900);
    expect(t.discountAmount).toBe(0);
    expect(t.subtotalAfterDiscount).toBe(7900);
    expect(t.salesTax).toBe(731);              // round(7900 * 0.0925)
    expect(t.total).toBe(8631);                // 7900 + 731
  });

  it('2. exchange negative subtotal: total = subtotalAfterDiscount + tax (not tax-only)', () => {
    const cart = [
      item({ id: 'credit', name: 'Crédito Cambio', category: 'exchange_credit', price: -10816, qty: 1, taxable: false }),
      item({ id: 'jbl', name: 'JBL TUNE FLEX', category: 'accessory', price: 7900, qty: 1, taxable: true }),
    ];
    const t = calculateCartTotals(cart, SETTINGS, NO_DISCOUNT, 'Cash', false);
    expect(t.subtotal).toBe(-2916);            // -10816 + 7900 = -29.16
    expect(t.discountAmount).toBe(0);          // no phantom negative discount
    expect(t.subtotalAfterDiscount).toBe(-2916); // preserved (was clamped to 0 by the bug)
    expect(t.salesTax).toBe(731);              // tax only on the +7900 taxable item
    expect(t.total).toBe(-2185);               // -2916 + 731 = -21.85 (store owes customer), NOT +731
  });

  it('3. discountAmount never becomes negative on a net-negative cart', () => {
    const cartNoDiscount = [
      item({ id: 'credit', category: 'exchange_credit', price: -10816, taxable: false }),
      item({ id: 'jbl', price: 7900, taxable: true }),
    ];
    expect(calculateCartTotals(cartNoDiscount, SETTINGS, NO_DISCOUNT, 'Cash', false).discountAmount).toBe(0);

    // Even a percent discount applied to a net-negative cart must not go negative.
    const pctDiscount: DiscountState = { amount: 10, type: 'percent', reason: '' } as DiscountState;
    expect(calculateCartTotals(cartNoDiscount, SETTINGS, pctDiscount, 'Cash', false).discountAmount).toBeGreaterThanOrEqual(0);

    // And a dollar discount on a net-negative cart must not go negative either.
    const dollarDiscount: DiscountState = { amount: 5, type: 'dollar', reason: '' } as DiscountState;
    expect(calculateCartTotals(cartNoDiscount, SETTINGS, dollarDiscount, 'Cash', false).discountAmount).toBeGreaterThanOrEqual(0);
  });

  it('positive sale with a real discount still applies it (regression guard)', () => {
    const cart = [item({ price: 10000, qty: 1, taxable: true })];
    const tenPct: DiscountState = { amount: 10, type: 'percent', reason: '' } as DiscountState;
    const t = calculateCartTotals(cart, SETTINGS, tenPct, 'Cash', false);
    expect(t.discountAmount).toBe(1000);       // 10% of 10000
    expect(t.subtotalAfterDiscount).toBe(9000);
  });
});
