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
  hasPaymentHistory, getSimpleCancelEligibility, canSimplyCancel, planSimpleCancellation,
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

describe('planSimpleCancellation — pure cancel effect (Special Orders reproduction)', () => {
  const NOW = '2026-07-18T10:00:00.000Z';
  // GUILLERMO RODRIGUEZ $2.00 order added to cart, plus an unrelated cart line.
  const order = { id: 'so-guillermo', status: 'ordered', depositAmount: 0, balance: 200, payments: [] };
  const cart = [
    { id: 'line-so', specialOrderId: 'so-guillermo', name: 'Special Order', price: 200, qty: 1 },
    { id: 'line-other', name: 'Screen Protector', price: 999, qty: 1 },
  ];

  it('eligible order → cancels, removes ONLY the linked cart line, keeps unrelated', () => {
    const plan = planSimpleCancellation({ type: 'special_order', record: order, cart, cartLinkKey: 'specialOrderId', now: NOW });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updatedRecord.status).toBe('cancelled');
    expect((plan.updatedRecord as { cancelledAt?: string }).cancelledAt).toBe(NOW);
    expect(plan.removedCartCount).toBe(1);
    expect(plan.nextCart.map((c) => c.id)).toEqual(['line-other']);   // unrelated preserved
    // cart total decreased by exactly the $2.00 line.
    const before = cart.reduce((s, c) => s + (c.price as number), 0);
    const after = plan.nextCart.reduce((s, c) => s + (c.price as number), 0);
    expect(before - after).toBe(200);
  });

  it('produces NO Sale / payment / store-credit (plan carries only record + cart)', () => {
    const plan = planSimpleCancellation({ type: 'special_order', record: order, cart, cartLinkKey: 'specialOrderId', now: NOW });
    // The plan surface is exactly the cancellation outputs — no financial artifacts.
    expect(Object.keys(plan).sort()).toEqual(['nextCart', 'ok', 'removedCartCount', 'updatedRecord']);
    if (!plan.ok) return;
    // No refund/sale/store-credit fields are added to the cancelled record.
    for (const k of ['refundSale', 'sale', 'payment', 'storeCredit', 'depositRefundMethod', 'depositRefundAmount']) {
      expect(k in plan.updatedRecord).toBe(false);
    }
  });

  it('re-checks eligibility: a paid order is blocked, cart untouched', () => {
    const paid = { id: 'so-paid', status: 'ordered', depositAmount: 500, balance: 0 };
    const plan = planSimpleCancellation({ type: 'special_order', record: paid, cart, cartLinkKey: 'specialOrderId', now: NOW });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.kind).toBe('payment_history');
  });

  it('already-cancelled order is blocked (no duplicate cancellation)', () => {
    const plan = planSimpleCancellation({ type: 'special_order', record: { id: 'x', status: 'cancelled' }, cart, cartLinkKey: 'specialOrderId', now: NOW });
    expect(plan.ok).toBe(false);
  });

  it('double-submit: re-planning the SAME order after it is cancelled is blocked', () => {
    // First pass cancels; a rapid second onSuccess re-plans the now-cancelled
    // record (as the handler re-reads it) → blocked, so it can never cancel twice.
    const first = planSimpleCancellation({ type: 'special_order', record: order, cart, cartLinkKey: 'specialOrderId', now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = planSimpleCancellation({ type: 'special_order', record: first.updatedRecord, cart: first.nextCart, cartLinkKey: 'specialOrderId', now: NOW });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.kind).toBe('already_cancelled');
  });

  it('removes by exact id, not by amount/name/index (two same-priced lines)', () => {
    const cart2 = [
      { id: 'a', specialOrderId: 'so-guillermo', price: 200 },
      { id: 'b', specialOrderId: 'so-other', price: 200 },   // same amount, different order
    ];
    const plan = planSimpleCancellation({ type: 'special_order', record: order, cart: cart2, cartLinkKey: 'specialOrderId', now: NOW });
    expect(plan.ok && plan.nextCart.map((c) => c.id)).toEqual(['b']);   // only Guillermo's line removed
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
