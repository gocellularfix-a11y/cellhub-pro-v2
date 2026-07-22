// P0-C1d (F-H) — a redundant/equivalent edit during an Exact Resume must NOT
// drop the frozen override; a genuine change must. Pure predicates used by the
// modal's carrier button + phone input.

import { describe, it, expect } from 'vitest';
import { resumedCarrierUnchanged, resumedPhoneUnchanged } from './phonePaymentResume';
import type { ResumeRestore } from './phonePaymentResume';

const r = (over: Partial<ResumeRestore> = {}): ResumeRestore => ({
  workflowId: 'wf-1',
  phoneNumber: '8055551212',
  transactionCarrier: 'Verizon',
  amountCents: 3750,
  portalId: 'WebPOS',
  portalUrl: 'https://frozen.example/webpos',
  lineIndex: 1,
  totalLines: 3,
  customerId: 'c1',
  ...over,
});

describe('resumedCarrierUnchanged (F-H carrier)', () => {
  it('1. same frozen carrier → keep override (true)', () => {
    expect(resumedCarrierUnchanged(r(), 'Verizon')).toBe(true);
  });
  it('2. normalized-equivalent carrier → keep (true)', () => {
    expect(resumedCarrierUnchanged(r({ transactionCarrier: 'AT&T' }), 'att')).toBe(true);
    expect(resumedCarrierUnchanged(r({ transactionCarrier: 'Verizon' }), 'VERIZON')).toBe(true);
  });
  it('3. different carrier → drop (false)', () => {
    expect(resumedCarrierUnchanged(r({ transactionCarrier: 'Verizon' }), 'H2O')).toBe(false);
  });
  it('no active resume → false (nothing to keep)', () => {
    expect(resumedCarrierUnchanged(null, 'Verizon')).toBe(false);
  });
});

describe('resumedPhoneUnchanged (F-H phone)', () => {
  it('4/5. equivalent phone formats → keep override (true)', () => {
    expect(resumedPhoneUnchanged(r(), '8055551212')).toBe(true);
    expect(resumedPhoneUnchanged(r(), '(805) 555-1212')).toBe(true);
    expect(resumedPhoneUnchanged(r(), '+1 805 555 1212')).toBe(true);
    expect(resumedPhoneUnchanged(r(), '18055551212')).toBe(true);
  });
  it('6. genuinely different phone → drop (false)', () => {
    expect(resumedPhoneUnchanged(r(), '8055559999')).toBe(false);
  });
  it('no active resume → false', () => {
    expect(resumedPhoneUnchanged(null, '8055551212')).toBe(false);
  });
});
