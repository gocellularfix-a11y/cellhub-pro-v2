// ============================================================
// R-INTEL-V2-PHASE0: card-fee unit regression test.
// Money is integer cents. The fee was revenue*0.029 + count*0.30, where the
// flat term added a third of a cent per sale instead of 30 cents. It is now
// count*30. This test pins the corrected magnitude.
// ============================================================

import { describe, it, expect } from 'vitest';
import { FinancialAnalyzer } from './FinancialAnalyzer';
import { computeCanonicalMoneyForRange, localDayRangeForWindow } from '../adapters/reportMoneyAdapter';
import type { CanonicalWindowProvider } from '../adapters/reportMoneyAdapter';
import type { Sale, Repair } from '@/store/types';

const now = new Date().toISOString();

// 2 sales at $100 each → revenue = 20,000 cents.
const sales = [
  { id: 's1', status: 'completed', total: 10_000, subtotal: 10_000, createdAt: now, items: [] },
  { id: 's2', status: 'completed', total: 10_000, subtotal: 10_000, createdAt: now, items: [] },
] as unknown as Sale[];

// I2B-2.1: getMetrics now requires the canonical range provider (the card-fee
// estimate is derived from canonical gross + txCount).
const provider: CanonicalWindowProvider = (window) => computeCanonicalMoneyForRange(
  { sales, repairs: [], unlocks: [], specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [], settings: {} },
  localDayRangeForWindow(window),
);

describe('FinancialAnalyzer.getMetrics — credit card fee in cents', () => {
  const m = new FinancialAnalyzer(sales, [] as unknown as Repair[], [], undefined, 'en', provider)
    .getMetrics({ start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) });

  it('applies 2.9% + a flat 30-cent per-transaction fee', () => {
    // 20000 * 0.029 = 580 ; flat = 2 * 30 = 60 ; total = 640 cents ($6.40)
    expect(m.creditCardFees).toBe(640);
  });

  it('flat fee is 30 cents, not 0.30 (old bug would give 581)', () => {
    expect(m.creditCardFees).toBeGreaterThan(600);
  });
});
