// ============================================================
// P0-C1b — exact-resume + sale-cleanup pure-helper tests (behavior, node env).
// ============================================================

import { describe, it, expect } from 'vitest';
import type { PendingWorkflow, ExternalPaymentMetadata } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import { resolveResumeAttempt, collectPhonePaymentWorkflowIds } from './phonePaymentResume';

const NOW = 1_000_000;
const meta = (over: Partial<ExternalPaymentMetadata> = {}): ExternalPaymentMetadata => ({
  phone: '8052238255', carrier: 'Verizon', amountCents: 5000, activeLine: '8052238255',
  lineIndex: 1, totalLines: 3, source: 'phone_payments',
  customerId: 'c1', portalId: 'WebPOS', portalUrl: 'https://webpos.example', dedupeKey: 'k1', ...over,
});
const wf = (over: Partial<PendingWorkflow> = {}): PendingWorkflow => ({
  id: 'wf-external_payment-1', type: 'external_payment', status: 'pending',
  startedAt: NOW - 1000, expiresAt: NOW + 60_000, metadata: meta(),
  steps: [], ...over,
});

describe('resolveResumeAttempt — frozen intent is the authority', () => {
  it('restores the EXACT frozen phone/carrier/amount/portal for a pending, non-expired workflow', () => {
    const r = resolveResumeAttempt(wf(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.restore).toEqual({
      workflowId: 'wf-external_payment-1',
      phoneNumber: '8052238255',
      transactionCarrier: 'Verizon',
      amountCents: 5000,
      portalId: 'WebPOS',
      portalUrl: 'https://webpos.example',
      lineIndex: 1,
      totalLines: 3,
      customerId: 'c1',
    });
  });

  it('refuses completed / cancelled workflows', () => {
    expect(resolveResumeAttempt(wf({ status: 'completed' }), NOW)).toMatchObject({ ok: false, reason: 'not_pending' });
    expect(resolveResumeAttempt(wf({ status: 'cancelled' }), NOW)).toMatchObject({ ok: false, reason: 'not_pending' });
  });

  it('refuses a TTL-expired workflow (pending but past expiresAt)', () => {
    expect(resolveResumeAttempt(wf({ expiresAt: NOW - 1 }), NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a missing workflow or invalid metadata', () => {
    expect(resolveResumeAttempt(null, NOW)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(resolveResumeAttempt(wf({ metadata: { phone: '', carrier: '' } as ExternalPaymentMetadata }), NOW))
      .toMatchObject({ ok: false, reason: 'invalid_metadata' });
  });

  it('customer record cannot override frozen values (they come only from metadata)', () => {
    const r = resolveResumeAttempt(wf({ metadata: meta({ carrier: 'H2O', amountCents: 3000 }) }), NOW);
    expect(r.ok && r.restore.transactionCarrier).toBe('H2O');
    expect(r.ok && r.restore.amountCents).toBe(3000);
  });
});

describe('collectPhonePaymentWorkflowIds — exact set to complete on sale', () => {
  it('collects distinct workflowIds of sold phone_payment lines only', () => {
    const items = [
      { category: 'phone_payment', workflowId: 'wfA' },
      { category: 'phone_payment', workflowId: 'wfB' },
      { category: 'product', workflowId: 'wfX' },       // not phone payment → ignored
      { category: 'phone_payment' },                     // no workflowId → ignored
    ];
    expect(collectPhonePaymentWorkflowIds(items)).toEqual(['wfA', 'wfB']);
  });

  it('dedupes two lines sharing one workflow', () => {
    const items = [
      { category: 'phone_payment', workflowId: 'wfA' },
      { category: 'phone_payment', workflowId: 'wfA' },
    ];
    expect(collectPhonePaymentWorkflowIds(items)).toEqual(['wfA']);
  });

  it('returns empty when no phone-payment line carries a workflowId', () => {
    expect(collectPhonePaymentWorkflowIds([{ category: 'phone_payment' }, { category: 'product', workflowId: 'x' }])).toEqual([]);
  });
});
