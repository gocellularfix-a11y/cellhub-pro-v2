// ============================================================
// R-PAYMENT-TRACE-RECEIPTS-LAYAWAY-SPECIAL-ORDER-V1 — payment trace logic.
// Pure-function tests for the trace computation + HTML render + history
// classification used by Layaway and Special Order receipts.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildPaymentTrace,
  renderPaymentTraceHtml,
  classifyHistoryRows,
  paymentTraceI18n,
  type PaymentTraceRow,
} from './paymentTrace';

const I18N = paymentTraceI18n((k) => k.replace('receipt.trace.', '')); // labels = short keys
const esc = (s: unknown) => String(s ?? '');
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const row = (over: Partial<PaymentTraceRow> = {}): PaymentTraceRow =>
  ({ date: '06/01/2026', type: 'payment', method: 'Cash', amountCents: 1000, ...over });

describe('buildPaymentTrace — layaway with history', () => {
  it('initial deposit (1 payment)', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 10000, totalPaidCents: 2000, balanceAfterCents: 8000,
      history: [row({ type: 'deposit', amountCents: 2000 })],
    });
    expect(t.previousPaymentsCents).toBe(0);
    expect(t.paymentTodayCents).toBe(2000);
    expect(t.totalPaidCents).toBe(2000);
    expect(t.balanceBeforeCents).toBe(10000);
    expect(t.balanceAfterCents).toBe(8000);
    expect(t.paymentCount).toBe(1);
    expect(t.isPaid).toBe(false);
  });

  it('second payment (2 payments)', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 10000, totalPaidCents: 3500, balanceAfterCents: 6500,
      history: [row({ type: 'deposit', amountCents: 2000 }), row({ amountCents: 1500 })],
    });
    expect(t.previousPaymentsCents).toBe(2000);
    expect(t.paymentTodayCents).toBe(1500);
    expect(t.totalPaidCents).toBe(3500);
    expect(t.balanceBeforeCents).toBe(8000);
    expect(t.paymentCount).toBe(2);
    expect(t.isPaid).toBe(false);
  });

  it('final payment (balance → 0 → Paid)', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 10000, totalPaidCents: 10000, balanceAfterCents: 0,
      history: [row({ type: 'deposit', amountCents: 2000 }), row({ amountCents: 4000 }), row({ amountCents: 4000 })],
    });
    expect(t.paymentTodayCents).toBe(4000);
    expect(t.previousPaymentsCents).toBe(6000);
    expect(t.balanceAfterCents).toBe(0);
    expect(t.paymentCount).toBe(3);
    expect(t.isPaid).toBe(true);
  });
});

describe('buildPaymentTrace — special order (summary, no history)', () => {
  it('initial deposit via fallbackToday', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 5000, totalPaidCents: 2000, balanceAfterCents: 3000,
      history: [], fallbackTodayCents: 2000,
    });
    expect(t.paymentTodayCents).toBe(2000);
    expect(t.previousPaymentsCents).toBe(0);
    expect(t.paymentCount).toBe(1);
    expect(t.hasToday).toBe(true);
    expect(t.history).toHaveLength(0);
  });

  it('reprint without override → summary only, no today/count noise', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 5000, totalPaidCents: 2000, balanceAfterCents: 3000,
      history: [], fallbackTodayCents: 0,
    });
    expect(t.hasToday).toBe(false);
    expect(t.paymentCount).toBe(0);
    expect(t.totalPaidCents).toBe(2000);
    expect(t.balanceAfterCents).toBe(3000);
    expect(t.isPaid).toBe(false);
  });

  it('fully paid special order → Paid', () => {
    const t = buildPaymentTrace({ originalTotalCents: 5000, totalPaidCents: 5000, balanceAfterCents: 0, history: [] });
    expect(t.isPaid).toBe(true);
  });
});

describe('buildPaymentTrace — repair / unlock summary mode (aggregates only)', () => {
  it('repair first deposit (fallbackToday = deposit)', () => {
    const t = buildPaymentTrace({ originalTotalCents: 12000, totalPaidCents: 4000, balanceAfterCents: 8000, history: [], fallbackTodayCents: 4000 });
    expect(t.hasToday).toBe(true);
    expect(t.paymentTodayCents).toBe(4000);
    expect(t.previousPaymentsCents).toBe(0);
    expect(t.paymentCount).toBe(1);
    expect(t.balanceBeforeCents).toBe(12000);
    expect(t.balanceAfterCents).toBe(8000);
    expect(t.isPaid).toBe(false);
    expect(t.history).toHaveLength(0);
  });

  it('unlock fully paid (deposit covers price) → Paid', () => {
    const t = buildPaymentTrace({ originalTotalCents: 6000, totalPaidCents: 6000, balanceAfterCents: 0, history: [], fallbackTodayCents: 6000 });
    expect(t.isPaid).toBe(true);
    expect(t.balanceAfterCents).toBe(0);
  });

  it('zero-deposit record → no today, count 0, full balance due', () => {
    const t = buildPaymentTrace({ originalTotalCents: 9000, totalPaidCents: 0, balanceAfterCents: 9000, history: [], fallbackTodayCents: 0 });
    expect(t.hasToday).toBe(false);
    expect(t.paymentCount).toBe(0);
    expect(t.totalPaidCents).toBe(0);
    expect(t.balanceAfterCents).toBe(9000);
    expect(t.isPaid).toBe(false);
  });

  it('repair/unlock summary render omits PAYMENT HISTORY', () => {
    const t = buildPaymentTrace({ originalTotalCents: 12000, totalPaidCents: 4000, balanceAfterCents: 8000, history: [], fallbackTodayCents: 4000 });
    const html = renderPaymentTraceHtml(t, I18N, esc, money);
    expect(html).toContain('title');
    expect(html).not.toContain('historyTitle');
    expect(html).toContain('statusBalanceDue');
  });
});

describe('classifyHistoryRows', () => {
  it('first = deposit, middle = payment, last (paid) = final', () => {
    const rows = classifyHistoryRows(
      [{ date: 'd1', method: 'Cash', amountCents: 2000 }, { date: 'd2', method: 'Card', amountCents: 1500 }, { date: 'd3', method: 'Cash', amountCents: 1500 }],
      true,
    );
    expect(rows.map((r) => r.type)).toEqual(['deposit', 'payment', 'final']);
  });

  it('not fully paid → last stays payment', () => {
    const rows = classifyHistoryRows(
      [{ date: 'd1', method: 'Cash', amountCents: 2000 }, { date: 'd2', method: 'Card', amountCents: 1500 }],
      false,
    );
    expect(rows.map((r) => r.type)).toEqual(['deposit', 'payment']);
  });
});

describe('renderPaymentTraceHtml', () => {
  it('renders the trace fields and PAYMENT HISTORY when rows exist', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 10000, totalPaidCents: 10000, balanceAfterCents: 0,
      history: classifyHistoryRows([
        { date: '06/01/2026', method: 'Cash', amountCents: 2000 },
        { date: '06/02/2026', method: 'Card', amountCents: 8000 },
      ], true),
    });
    const html = renderPaymentTraceHtml(t, I18N, esc, money);
    expect(html).toContain('title'); // PAYMENT TRACE title key
    expect(html).toContain('historyTitle'); // PAYMENT HISTORY
    expect(html).toContain('$100.00'); // original total
    expect(html).toContain('Card');
    expect(html).toContain('typeFinal');
    expect(html).toContain('statusPaid');
  });

  it('summary-only trace omits PAYMENT HISTORY', () => {
    const t = buildPaymentTrace({ originalTotalCents: 5000, totalPaidCents: 2000, balanceAfterCents: 3000, history: [], fallbackTodayCents: 2000 });
    const html = renderPaymentTraceHtml(t, I18N, esc, money);
    expect(html).toContain('title');
    expect(html).not.toContain('historyTitle');
    expect(html).toContain('statusBalanceDue');
  });

  it('missing method/date → safe fallback labels', () => {
    const t = buildPaymentTrace({
      originalTotalCents: 3000, totalPaidCents: 3000, balanceAfterCents: 0,
      history: [{ date: '', type: 'deposit', method: '', amountCents: 3000 }],
    });
    const html = renderPaymentTraceHtml(t, I18N, esc, money);
    expect(html).toContain('dateUnavailable');
    expect(html).toContain('unknownMethod');
  });
});
