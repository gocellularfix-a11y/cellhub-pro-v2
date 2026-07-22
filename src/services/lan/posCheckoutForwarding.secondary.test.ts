// P0-C1d (F-B) — the Secondary completes its OWN machine-local phone-payment
// workflows after a committed forwarded checkout. This tests the pure gating
// (secondaryWorkflowIdsToComplete) that the POSModule Secondary path uses to
// decide WHICH ids to complete for a given forward outcome. The actual store
// write + idempotency/failure handling is covered by
// completePhonePaymentWorkflows.test.ts.

import { describe, it, expect } from 'vitest';
import { secondaryWorkflowIdsToComplete } from './posCheckoutForwarding';

type Item = { category?: string; workflowId?: string };

const items = (...xs: Item[]): Item[] => xs;

describe('secondaryWorkflowIdsToComplete (F-B)', () => {
  it('A/F. committed → collects the sale\'s phone-payment workflowIds (dedup)', () => {
    const sale = items(
      { category: 'phone_payment', workflowId: 'A' },
      { category: 'phone_payment', workflowId: 'A' }, // dup line, same workflow
    );
    expect(secondaryWorkflowIdsToComplete('committed', sale)).toEqual(['A']);
  });

  it('B. two workflows → both, exactly once each', () => {
    const sale = items(
      { category: 'phone_payment', workflowId: 'A' },
      { category: 'phone_payment', workflowId: 'B' },
    );
    expect(secondaryWorkflowIdsToComplete('committed', sale)).toEqual(['A', 'B']);
  });

  it('C. mixed sale → ONLY phone_payment workflowIds (ignores accessory/other)', () => {
    const sale = items(
      { category: 'phone_payment', workflowId: 'A' },
      { category: 'accessory', workflowId: 'X' },   // not a phone payment → ignored
      { category: 'phone_payment' },                 // no workflowId → ignored
    );
    expect(secondaryWorkflowIdsToComplete('committed', sale)).toEqual(['A']);
  });

  it('D. rejected → NO workflows completed', () => {
    const sale = items({ category: 'phone_payment', workflowId: 'A' });
    expect(secondaryWorkflowIdsToComplete('rejected', sale)).toEqual([]);
  });

  it('E. unknown → NO workflows completed (keep pending for retry)', () => {
    const sale = items({ category: 'phone_payment', workflowId: 'A' });
    expect(secondaryWorkflowIdsToComplete('unknown', sale)).toEqual([]);
  });

  it('committed with no phone-payment workflow lines → empty (no-op)', () => {
    expect(secondaryWorkflowIdsToComplete('committed', items({ category: 'accessory' }))).toEqual([]);
    expect(secondaryWorkflowIdsToComplete('committed', [])).toEqual([]);
  });

  it('G/H. operates on the EXACT items passed (per-operation), not any shared/mutable state', () => {
    const opA = items({ category: 'phone_payment', workflowId: 'A' });
    const opB = items({ category: 'phone_payment', workflowId: 'B' });
    // A late ACK for op A completes A only; op B completes B only.
    expect(secondaryWorkflowIdsToComplete('committed', opA)).toEqual(['A']);
    expect(secondaryWorkflowIdsToComplete('committed', opB)).toEqual(['B']);
  });
});
