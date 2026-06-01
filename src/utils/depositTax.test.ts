// ============================================================
// R-STABILIZE-1 T2 — Characterization tests for the deposit tax helper.
//
// These lock the CURRENT behavior of the single source of truth for money
// math (forwardTaxFromBase / reverseTaxFromPayment / calcDepositTotals).
// They are intentionally exhaustive on the edges that have bitten before:
// the penny-correction in reverse tax, taxable=false, and zero/invalid input.
//
// NOTE: the canonical file lives at src/utils/depositTax.ts (NOT
// src/services/tax/depositTax.ts as the round brief stated). The file was
// not moved — tests sit next to the real source.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  forwardTaxFromBase,
  reverseTaxFromPayment,
  calcDepositTotals,
} from './depositTax';

const RATE = 0.0925; // 9.25%

describe('forwardTaxFromBase', () => {
  it('adds tax on top of a pre-tax base', () => {
    // $457.65 base @ 9.25% -> $42.33 tax -> $499.98 total
    expect(forwardTaxFromBase(45765, RATE, true)).toEqual({
      baseCents: 45765,
      taxCents: 4233,
      totalCents: 49998,
    });
  });

  it('round-trips the $183.07 base back to $200.00', () => {
    expect(forwardTaxFromBase(18307, RATE, true)).toEqual({
      baseCents: 18307,
      taxCents: 1693,
      totalCents: 20000,
    });
  });

  it('taxable=false -> zero tax, total equals base', () => {
    expect(forwardTaxFromBase(10000, RATE, false)).toEqual({
      baseCents: 10000,
      taxCents: 0,
      totalCents: 10000,
    });
  });

  it('zero base is safe', () => {
    expect(forwardTaxFromBase(0, RATE, true)).toEqual({
      baseCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it('negative / NaN base clamps to 0', () => {
    expect(forwardTaxFromBase(-500, RATE, true)).toEqual({
      baseCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
    expect(forwardTaxFromBase(NaN as unknown as number, RATE, true)).toEqual({
      baseCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it('missing rate is treated as 0', () => {
    expect(forwardTaxFromBase(10000, undefined as unknown as number, true)).toEqual({
      baseCents: 10000,
      taxCents: 0,
      totalCents: 10000,
    });
  });
});

describe('reverseTaxFromPayment', () => {
  it('splits a $200.00 tax-inclusive payment @ 9.25% into $183.07 + $16.93', () => {
    const r = reverseTaxFromPayment(20000, RATE, true);
    expect(r).toEqual({ baseCents: 18307, taxCents: 1693 });
    // Invariant: base + tax always reconstructs the exact payment.
    expect(r.baseCents + r.taxCents).toBe(20000);
  });

  it('penny-correction case: $1.00 payment still sums back to the payment', () => {
    // Naive round(100 / 1.0925) = 92, whose forward check overshoots to 101,
    // so the helper nudges the base down by a penny. Locked behavior:
    const r = reverseTaxFromPayment(100, RATE, true);
    expect(r).toEqual({ baseCents: 91, taxCents: 9 });
    expect(r.baseCents + r.taxCents).toBe(100); // invariant holds
  });

  it('base + tax === payment across a sweep of values (no money created/lost)', () => {
    for (let payment = 1; payment <= 5000; payment += 7) {
      const r = reverseTaxFromPayment(payment, RATE, true);
      expect(r.baseCents + r.taxCents).toBe(payment);
      expect(r.baseCents).toBeGreaterThanOrEqual(0);
      expect(r.taxCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('taxable=false -> full payment is base, zero tax', () => {
    expect(reverseTaxFromPayment(10000, RATE, false)).toEqual({
      baseCents: 10000,
      taxCents: 0,
    });
  });

  it('zero / negative payment is safe', () => {
    expect(reverseTaxFromPayment(0, RATE, true)).toEqual({ baseCents: 0, taxCents: 0 });
    expect(reverseTaxFromPayment(-100, RATE, true)).toEqual({ baseCents: 0, taxCents: 0 });
  });
});

describe('calcDepositTotals', () => {
  it('computes tax, total and remaining balance', () => {
    // $1,000 price @ 9.25% = $92.50 tax -> $1,092.50 total; $500 deposit
    expect(calcDepositTotals(100000, 50000, RATE, true)).toEqual({
      subtotalCents: 100000,
      taxCents: 9250,
      totalWithTaxCents: 109250,
      balanceCents: 59250,
    });
  });

  it('balance never goes negative when the deposit exceeds the total', () => {
    const r = calcDepositTotals(10000, 99999, RATE, true);
    expect(r.balanceCents).toBe(0);
  });

  it('taxable=false -> no tax in the totals', () => {
    expect(calcDepositTotals(10000, 0, RATE, false)).toEqual({
      subtotalCents: 10000,
      taxCents: 0,
      totalWithTaxCents: 10000,
      balanceCents: 10000,
    });
  });

  it('zero / negative / NaN inputs are clamped to safe zeros', () => {
    expect(calcDepositTotals(-100, -50, RATE, true)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalWithTaxCents: 0,
      balanceCents: 0,
    });
    expect(
      calcDepositTotals(NaN as unknown as number, NaN as unknown as number, RATE, true),
    ).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalWithTaxCents: 0,
      balanceCents: 0,
    });
  });
});
