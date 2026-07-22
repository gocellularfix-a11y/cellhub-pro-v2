// P0-C1c (F-A/F-D/F-E) — behavioral tests for the pure resume helpers that
// back the frozen-portal override, the Known-Lines resume cart line, and the
// canonical workflow key. React wiring (the override effect / scanner priority)
// is runtime and verified in owner QA; these prove the data contracts.

import { describe, it, expect } from 'vitest';
import { phonePaymentLineKey, buildResumedCartItemFields, resolveResumeAttempt } from './phonePaymentResume';
import type { ResumeRestore } from './phonePaymentResume';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import type { StoreSettings } from '@/store/types';

const settings = {
  carrierCommissions: { Verizon: 0.07, H2O: 0.10 },
  defaultCommissionRate: 0.05,
} as unknown as StoreSettings;

const restore = (over: Partial<ResumeRestore> = {}): ResumeRestore => ({
  workflowId: 'wf-1',
  phoneNumber: '8055551212',
  transactionCarrier: 'Verizon',
  amountCents: 3750,
  portalId: 'WebPOS',
  portalUrl: 'https://frozen.example.com/webpos',
  lineIndex: 1,
  totalLines: 3,
  customerId: 'cust-1',
  ...over,
});

describe('phonePaymentLineKey — canonical key (F-E)', () => {
  it('equivalent formats collapse to ONE key', () => {
    const k = '8055551212';
    expect(phonePaymentLineKey('(805) 555-1212')).toBe(k);
    expect(phonePaymentLineKey('805-555-1212')).toBe(k);
    expect(phonePaymentLineKey('8055551212')).toBe(k);
    expect(phonePaymentLineKey('+1 805 555 1212')).toBe(k);
    expect(phonePaymentLineKey('18055551212')).toBe(k);
  });

  it('11-digit +1 does NOT diverge (the sanitize-first-10 vs normalize-last-10 bug)', () => {
    // sanitizePhone would yield "1805555121" (first 10) → a different key.
    expect(phonePaymentLineKey('18055551212')).toBe('8055551212');
  });

  it('empty / invalid never collide with a valid 10-digit line', () => {
    expect(phonePaymentLineKey('')).toBe('');
    expect(phonePaymentLineKey('abc')).toBe('');
    expect(phonePaymentLineKey('555')).toBe('555');
    expect(phonePaymentLineKey('555')).not.toBe('8055551212');
  });

  it('>11 digits → last 10', () => {
    expect(phonePaymentLineKey('9998055551212')).toBe('8055551212');
  });
});

describe('buildResumedCartItemFields — frozen cart line (F-A/F-D)', () => {
  it('builds exactly one line from FROZEN metadata (carrier/amount/portal/workflowId)', () => {
    const it0 = buildResumedCartItemFields(restore(), settings, 'Jane Doe');
    expect(it0.category).toBe('phone_payment');
    expect(it0.carrier).toBe('Verizon');
    expect(it0.phoneNumber).toBe('8055551212');
    expect(it0.price).toBe(3750);                 // frozen amount, not recalculated
    expect(it0.portal).toBe('WebPOS');            // F-A: frozen portalId
    expect(it0.workflowId).toBe('wf-1');          // frozen identity → SaleItem
    expect(it0.commissionRate).toBe(0.07);        // existing carrier→rate rule
    expect(it0.cost).toBe(Math.round(3750 * (1 - 0.07)));
    expect(it0.notes).toBe('Jane Doe');
  });

  it('frozen portalId wins even if settings would resolve a different carrier rate', () => {
    // H2O frozen attempt → uses H2O rate + frozen portalId regardless of the
    // customer's *current* carrier (which this pure builder never reads).
    const it0 = buildResumedCartItemFields(restore({ transactionCarrier: 'H2O', portalId: 'H2O', amountCents: 5000 }), settings, '');
    expect(it0.carrier).toBe('H2O');
    expect(it0.portal).toBe('H2O');
    expect(it0.commissionRate).toBe(0.10);
    expect(it0.price).toBe(5000);
  });

  it('missing portalId → no portal field (but workflowId still stamped)', () => {
    const it0 = buildResumedCartItemFields(restore({ portalId: '' }), settings, '');
    expect('portal' in it0).toBe(false);
    expect(it0.workflowId).toBe('wf-1');
  });
});

describe('resolveResumeAttempt — frozen portal source (F-A)', () => {
  const base = (over: Partial<PendingWorkflow> = {}): PendingWorkflow => ({
    id: 'wf-1',
    type: 'external_payment',
    status: 'pending',
    startedAt: 1000,
    expiresAt: 10_000,
    metadata: {
      phone: '8055551212', carrier: 'Verizon', amountCents: 3750, activeLine: '8055551212',
      lineIndex: 1, totalLines: 3, source: 'phone_payments', customerId: 'cust-1',
      portalId: 'WebPOS', portalUrl: 'https://frozen.example.com/webpos',
    },
    ...over,
  });

  it('restores frozen portalId + portalUrl (never re-derived)', () => {
    const res = resolveResumeAttempt(base(), 5000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.restore.portalId).toBe('WebPOS');
      expect(res.restore.portalUrl).toBe('https://frozen.example.com/webpos');
      expect(res.restore.amountCents).toBe(3750);
    }
  });

  it('does NOT restore completed/cancelled/expired', () => {
    expect(resolveResumeAttempt(base({ status: 'completed' }), 5000).ok).toBe(false);
    expect(resolveResumeAttempt(base({ status: 'cancelled' }), 5000).ok).toBe(false);
    expect(resolveResumeAttempt(base(), 20_000).ok).toBe(false); // past expiresAt
  });
});
