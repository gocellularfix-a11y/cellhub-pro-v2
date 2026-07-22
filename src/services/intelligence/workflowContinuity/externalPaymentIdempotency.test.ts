// ============================================================
// P0-C1 — external phone-payment workflow idempotency + selection tests.
// Uses an in-memory localStorage polyfill (node env has none) and a
// controlled clock so "most recent" is deterministic.
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  beginExternalPhonePayment,
  getMostRecentExternalPaymentWorkflow,
  getPendingWorkflows,
  completeWorkflow,
} from './workflowContinuityStore';
import type { ExternalPaymentMetadata } from './workflowContinuityTypes';

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const meta = (over: Partial<ExternalPaymentMetadata> = {}): ExternalPaymentMetadata => ({
  phone: '8055705895', carrier: 'H2O', amountCents: 3000, activeLine: '8055705895',
  lineIndex: 0, totalLines: 1, source: 'phone_payments',
  dedupeKey: 'c1|8055705895|3000|H2O', ...over,
});

let nowMs = 1_000_000;

beforeEach(() => {
  installLocalStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage.clear();
  nowMs = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('external payment idempotency', () => {
  it('first launch creates exactly one workflow', () => {
    beginExternalPhonePayment(meta());
    expect(getPendingWorkflows().filter((w) => w.type === 'external_payment')).toHaveLength(1);
  });

  it('repeated launch with the same dedupeKey does NOT create a second workflow', () => {
    const a = beginExternalPhonePayment(meta());
    nowMs += 500;
    const b = beginExternalPhonePayment(meta());
    expect(b.id).toBe(a.id); // reused
    expect(getPendingWorkflows().filter((w) => w.type === 'external_payment')).toHaveLength(1);
  });

  it('a different attempt (different portal/amount) creates a distinct workflow', () => {
    beginExternalPhonePayment(meta());
    nowMs += 1000;
    beginExternalPhonePayment(meta({ amountCents: 5000, dedupeKey: 'c1|8055705895|5000|H2O' }));
    expect(getPendingWorkflows().filter((w) => w.type === 'external_payment')).toHaveLength(2);
  });

  it('a genuine repeat AFTER the first completes creates a fresh workflow', () => {
    const a = beginExternalPhonePayment(meta());
    completeWorkflow(a.id);
    nowMs += 2000;
    const b = beginExternalPhonePayment(meta());
    expect(b.id).not.toBe(a.id);
    expect(getPendingWorkflows().filter((w) => w.type === 'external_payment')).toHaveLength(1);
  });
});

describe('most-recent selection (never the oldest)', () => {
  it('returns the most recently started active external payment', () => {
    const older = beginExternalPhonePayment(meta({ dedupeKey: 'k-old', phone: '1111111111' }));
    nowMs += 5000;
    const newer = beginExternalPhonePayment(meta({ dedupeKey: 'k-new', phone: '2222222222' }));
    const picked = getMostRecentExternalPaymentWorkflow();
    expect(picked?.id).toBe(newer.id);
    expect(picked?.id).not.toBe(older.id);
  });
});
