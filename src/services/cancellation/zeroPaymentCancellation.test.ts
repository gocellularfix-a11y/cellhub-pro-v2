// ============================================================
// Zero-Payment Cancellation Policy — eligibility tests.
//
// Proves the authoritative rule across Repairs / Unlocks / Special Orders /
// Layaways: simple (PIN, no-refund) cancellation is allowed ONLY for records
// with NO payment/deposit history and a non-final status. The refunded-to-zero
// case (paid then refunded, balance now $0) MUST stay blocked.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  hasPaymentHistory, getSimpleCancelEligibility, canSimplyCancel,
} from './zeroPaymentCancellation';
import type { CancellableRecord } from './zeroPaymentCancellation';

describe('Special Orders eligibility', () => {
  it('active $2 order with no deposit/payments → simple_cancel (the reproduction)', () => {
    const so: CancellableRecord = { status: 'ordered', depositAmount: 0, balance: 200, payments: [] };
    expect(getSimpleCancelEligibility('special_order', so)).toEqual({ eligible: true, kind: 'simple_cancel' });
    expect(canSimplyCancel('special_order', so)).toBe(true);
  });
  it('order with a deposit → blocked by payment_history', () => {
    const so: CancellableRecord = { status: 'ordered', depositAmount: 500, balance: 0 };
    expect(getSimpleCancelEligibility('special_order', so).kind).toBe('payment_history');
  });
  it('order with a logged payment but depositAmount 0 (refunded) → still blocked', () => {
    const so: CancellableRecord = { status: 'ordered', depositAmount: 0, balance: 200, payments: [{ date: 'x', amountCents: 500 }] };
    expect(canSimplyCancel('special_order', so)).toBe(false);
    expect(getSimpleCancelEligibility('special_order', so).kind).toBe('payment_history');
  });
  it('already cancelled → cannot cancel again', () => {
    expect(getSimpleCancelEligibility('special_order', { status: 'cancelled' }).kind).toBe('already_cancelled');
  });
  it('picked_up / refund_pending / refunded are protected', () => {
    for (const status of ['picked_up', 'refund_pending', 'refunded']) {
      expect(getSimpleCancelEligibility('special_order', { status }).kind).toBe('final_status');
    }
  });
});

describe('Repairs eligibility', () => {
  it('open repair with no deposit/meta → simple_cancel', () => {
    expect(canSimplyCancel('repair', { status: 'received', depositAmount: 0 })).toBe(true);
    expect(canSimplyCancel('repair', { status: 'in_progress', depositAmount: 0 })).toBe(true);
  });
  it('repair with a deposit → blocked', () => {
    expect(getSimpleCancelEligibility('repair', { status: 'received', depositAmount: 1000 }).kind).toBe('payment_history');
  });
  it('repair with depositMeta but depositAmount 0 (paid then refunded) → still blocked', () => {
    const r: CancellableRecord = { status: 'received', depositAmount: 0, depositMeta: { originalCents: 1000 } };
    expect(canSimplyCancel('repair', r)).toBe(false);
    expect(getSimpleCancelEligibility('repair', r).kind).toBe('payment_history');
  });
  it('completed / picked_up repair is protected', () => {
    expect(getSimpleCancelEligibility('repair', { status: 'picked_up' }).kind).toBe('final_status');
    expect(getSimpleCancelEligibility('repair', { status: 'completed' }).kind).toBe('final_status');
  });
});

describe('Unlocks eligibility', () => {
  it('pending / in_progress unlock with no payment → simple_cancel', () => {
    expect(canSimplyCancel('unlock', { status: 'pending', depositAmount: 0 })).toBe(true);
    expect(canSimplyCancel('unlock', { status: 'in_progress', depositAmount: 0 })).toBe(true);
  });
  it('unlock with a deposit → blocked', () => {
    expect(getSimpleCancelEligibility('unlock', { status: 'pending', depositAmount: 2000 }).kind).toBe('payment_history');
  });
  it('completed unlock is protected', () => {
    expect(getSimpleCancelEligibility('unlock', { status: 'completed' }).kind).toBe('final_status');
  });
});

describe('Layaways eligibility', () => {
  it('layaway with no deposit/payments → simple_cancel', () => {
    expect(canSimplyCancel('layaway', { status: 'active', paidAmount: 0, payments: [] })).toBe(true);
  });
  it('layaway with any deposit (paidAmount) → blocked', () => {
    expect(getSimpleCancelEligibility('layaway', { status: 'active', paidAmount: 1000 }).kind).toBe('payment_history');
  });
  it('layaway with a payments log → blocked', () => {
    expect(canSimplyCancel('layaway', { status: 'active', paidAmount: 0, payments: [{ id: 'p1', amountCents: 500 }] })).toBe(false);
  });
  it('layaway with a legacy depositMethod → blocked', () => {
    expect(getSimpleCancelEligibility('layaway', { status: 'active', depositMethod: 'cash' }).kind).toBe('payment_history');
  });
  it('completed / fulfilled / forfeited layaway is protected', () => {
    for (const status of ['completed', 'fulfilled', 'forfeited']) {
      expect(getSimpleCancelEligibility('layaway', { status }).kind).toBe('final_status');
    }
  });
});

describe('hasPaymentHistory — authoritative, balance-independent', () => {
  it('balance === total (nothing paid) is NOT payment history', () => {
    expect(hasPaymentHistory('special_order', { depositAmount: 0, balance: 200 })).toBe(false);
  });
  it('paid-then-refunded (current balance 0) IS payment history', () => {
    expect(hasPaymentHistory('layaway', { paidAmount: 0, payments: [{ id: 'p', amountCents: 1000 }] })).toBe(true);
    expect(hasPaymentHistory('repair', { depositAmount: 0, depositMeta: {} })).toBe(true);
    expect(hasPaymentHistory('special_order', { depositAmount: 0, payments: [{ amountCents: 1 }] })).toBe(true);
  });
  it('is deterministic and never throws on empty/partial records', () => {
    for (const type of ['repair', 'unlock', 'special_order', 'layaway'] as const) {
      expect(() => getSimpleCancelEligibility(type, {})).not.toThrow();
      expect(getSimpleCancelEligibility(type, {})).toEqual({ eligible: true, kind: 'simple_cancel' });
    }
  });
});
