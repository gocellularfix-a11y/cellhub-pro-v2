import { describe, it, expect } from 'vitest';
import { isTaxableCheckoutBlocked } from './taxConfirmGuard';

describe('isTaxableCheckoutBlocked (R-PRODUCTION-B4)', () => {
  it('fresh/unconfirmed + taxable cart → blocked', () => {
    expect(isTaxableCheckoutBlocked(false, 185)).toBe(true);
    expect(isTaxableCheckoutBlocked(undefined, 185)).toBe(true);
  });

  it('confirmed + taxable cart → allowed', () => {
    expect(isTaxableCheckoutBlocked(true, 185)).toBe(false);
  });

  it('unconfirmed + non-taxable cart (0 tax) → allowed', () => {
    expect(isTaxableCheckoutBlocked(false, 0)).toBe(false);
    expect(isTaxableCheckoutBlocked(undefined, 0)).toBe(false);
    expect(isTaxableCheckoutBlocked(false, undefined)).toBe(false);
  });

  it('confirmed + non-taxable cart → allowed', () => {
    expect(isTaxableCheckoutBlocked(true, 0)).toBe(false);
  });

  it('only `true` counts as confirmed (no truthy coercion bypass)', () => {
    // Defensive: a non-boolean stored value must not accidentally confirm.
    expect(isTaxableCheckoutBlocked('yes' as unknown as boolean, 185)).toBe(true);
    expect(isTaxableCheckoutBlocked(1 as unknown as boolean, 185)).toBe(true);
  });

  it('is deterministic — same inputs → same output', () => {
    expect(isTaxableCheckoutBlocked(false, 185)).toBe(isTaxableCheckoutBlocked(false, 185));
  });
});
