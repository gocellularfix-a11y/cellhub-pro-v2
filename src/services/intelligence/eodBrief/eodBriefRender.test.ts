// ============================================================
// R-INTELLIGENCE-EOD-A2B — Render tender / fees / tax breakdown.
//
// Asserts handleEndOfDayBrief() renders the A2A breakdowns:
//   - tender section (revenue decomposition) — employee-allowed.
//   - taxes/fees section — gated behind profitVisible (owner only).
//   - sections omitted when unavailable; no fake zeros.
//
// Labels asserted against the EN i18n strings added this round.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { handleEndOfDayBrief } from './handleEndOfDayBrief';

function isoTodayNoon(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function buildEngine(sales: any[], returns: any[] = []): IntelligenceEngine {
  return new IntelligenceEngine(
    sales as any,
    [], [], [],
    {},
    { customerReturns: returns as any, settings: {} } as any,
  );
}

function sale(over: Record<string, any> = {}): any {
  return {
    id: over.id ?? 's1',
    invoiceNumber: over.invoiceNumber ?? 'INV',
    createdAt: over.createdAt ?? isoTodayNoon(),
    status: over.status ?? 'completed',
    paymentMethod: over.paymentMethod ?? 'cash',
    total: over.total ?? 10000,
    items: over.items ?? [
      { id: 'i', name: 'Glass', category: 'accessory', price: over.total ?? 10000, qty: 1, cost: 6000 },
    ],
    ...over,
  };
}

describe('handleEndOfDayBrief — A2B tender render', () => {
  it('renders the tender section with non-zero buckets (owner)', () => {
    const engine = buildEngine([
      sale({ id: 'a', paymentMethod: 'cash', total: 10000 }),
      sale({ id: 'b', paymentMethod: 'card', total: 5000 }),
    ]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, true);
    expect(res.text).toContain('Tender');
    expect(res.text).toContain('Cash');
    expect(res.text).toContain('$100.00');
    expect(res.text).toContain('Card');
    expect(res.text).toContain('$50.00');
  });

  it('renders tender for an employee too (revenue decomposition, not gated)', () => {
    const engine = buildEngine([sale({ id: 'a', paymentMethod: 'cash', total: 10000 })]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, false);
    expect(res.text).toContain('Cash');
    expect(res.text).toContain('$100.00');
  });

  it('omits zero tender buckets', () => {
    const engine = buildEngine([sale({ id: 'a', paymentMethod: 'cash', total: 10000 })]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, true);
    // No card/store-credit activity → those labels must not appear.
    expect(res.text).not.toContain('Store credit');
  });
});

describe('handleEndOfDayBrief — A2B taxes/fees render', () => {
  it('renders the taxes/fees section for the owner', () => {
    const engine = buildEngine([
      sale({ id: 'a', total: 10000, salesTax: 800, utilityTax: 150, creditCardFee: 300 }),
    ]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, true);
    expect(res.text).toContain('Taxes');
    expect(res.text).toContain('Sales tax');
    expect(res.text).toContain('$8.00');     // salesTax
    expect(res.text).toContain('Utility tax');
    expect(res.text).toContain('Card surcharge');
    // Total collected = 800 + 150 + 300 = 1250 → $12.50
    expect(res.text).toContain('$12.50');
  });

  it('does NOT render taxes/fees for a non-owner (employee gate)', () => {
    const engine = buildEngine([
      sale({ id: 'a', total: 10000, salesTax: 800, utilityTax: 150 }),
    ]);
    const res = handleEndOfDayBrief(engine, 'en', undefined, false);
    expect(res.text).not.toContain('Taxes');
    expect(res.text).not.toContain('Sales tax');
    // ...but revenue/tender are still visible to the employee.
    expect(res.text).toContain('$100.00');
  });

  it('omits the fees section entirely when no tax/fee was collected', () => {
    const engine = buildEngine([sale({ id: 'a', total: 10000 })]); // no tax fields
    const res = handleEndOfDayBrief(engine, 'en', undefined, true);
    expect(res.text).not.toContain('Sales tax');
    expect(res.text).not.toContain('Taxes & fees');
  });
});

describe('handleEndOfDayBrief — A2B unavailable data', () => {
  it('empty day → no tender and no taxes sections', () => {
    const res = handleEndOfDayBrief(buildEngine([]), 'en', undefined, true);
    expect(res.text).not.toContain('Tender');
    expect(res.text).not.toContain('Sales tax');
  });
});
