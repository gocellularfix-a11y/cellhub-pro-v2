// ============================================================
// P0-C1 — structural guardrails locking the safety wiring into the real
// runtime files (node env, no renderer). These assert the corrected behavior
// is wired into PhonePaymentModal / FloatingOperatorBubble, not just present
// in helpers — so a future edit can't silently regress it.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const MODAL = read('src/modules/pos/PhonePaymentModal.tsx');
const BUBBLE = read('src/components/operator/FloatingOperatorBubble.tsx');

describe('premature Operator Bubble wake removed', () => {
  it('the modal no longer emits payment activity on selection / typing', () => {
    expect(MODAL).not.toContain("emitOperatorActivity('phone.payment.customer_selected'");
    expect(MODAL).not.toContain("emitOperatorActivity('phone.payment.number_entered'");
    expect(MODAL).not.toContain("emitOperatorActivity('phone.payment.known_line_selected'");
  });
});

describe('launch-first + idempotent workflow wiring', () => {
  it('uses the canonical launch orchestrator and idempotent begin (not the old startWorkflow)', () => {
    expect(MODAL).toContain('runExternalPaymentLaunch');
    expect(MODAL).toContain('beginExternalPhonePayment');
    expect(MODAL).not.toContain('startWorkflow(');
  });
  it('uses the canonical portal resolver and per-line carrier authority', () => {
    expect(MODAL).toContain('resolvePaymentPortal');
    expect(MODAL).toContain('getCarrierForPhone');
  });
});

describe('portal display == launch (read-only grid)', () => {
  it('the portal pills are no longer clickable toggles that can diverge from launch', () => {
    expect(MODAL).not.toContain('onClick={() => setPortal(active');
  });
});

describe('resume opens the real POS context (no dead phone-payments tab)', () => {
  it('the bubble resume no longer targets the unrendered phone-payments tab', () => {
    // The only remaining reference must be the relatedModule label in the store,
    // never a SET_ACTIVE_TAB navigation from the bubble's resume handler.
    expect(BUBBLE).not.toContain("payload: 'phone-payments'");
  });
  it('the bubble resume navigates to POS and reopens the modal with the customer', () => {
    expect(BUBBLE).toContain("payload: 'pos'");
    expect(BUBBLE).toContain('SET_PENDING_PHONE_PAYMENT_CUSTOMER');
  });
});
