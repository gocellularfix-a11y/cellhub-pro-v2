// P0-C1c (F-B/F-F) — behavioral tests for the shared committed-sale workflow
// cleanup used by BOTH local POS and the LAN dispatcher. Verifies dedupe,
// idempotency, non-fatal failure handling, and that it never throws (a
// localStorage cleanup failure must not revert an already-committed sale).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const completeWorkflow = vi.fn();
vi.mock('@/services/intelligence/workflowContinuity/workflowContinuityStore', () => ({
  completeWorkflow: (id: string) => completeWorkflow(id),
}));

import { completeCommittedPhonePaymentWorkflows } from './completePhonePaymentWorkflows';

beforeEach(() => { completeWorkflow.mockReset(); completeWorkflow.mockImplementation(() => {}); });

describe('completeCommittedPhonePaymentWorkflows', () => {
  it('dedupes ids before completing', () => {
    const r = completeCommittedPhonePaymentWorkflows(['a', 'a', 'b'], 'local', 's1');
    expect(r.attempted).toBe(2);
    expect(completeWorkflow).toHaveBeenCalledTimes(2);
    expect(r.completed).toBe(2);
    expect(r.failedIds).toEqual([]);
  });

  it('drops falsy ids', () => {
    const r = completeCommittedPhonePaymentWorkflows(['a', '', undefined as unknown as string, null as unknown as string], 'lan');
    expect(r.attempted).toBe(1);
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
    expect(completeWorkflow).toHaveBeenCalledWith('a');
  });

  it('is a no-op for empty / null / undefined input (idempotent)', () => {
    expect(completeCommittedPhonePaymentWorkflows([], 'local').attempted).toBe(0);
    expect(completeCommittedPhonePaymentWorkflows(null, 'local').attempted).toBe(0);
    expect(completeCommittedPhonePaymentWorkflows(undefined, 'lan').attempted).toBe(0);
    expect(completeWorkflow).not.toHaveBeenCalled();
  });

  it('one throwing id does not abort the rest; captured in failedIds; NEVER throws', () => {
    completeWorkflow.mockImplementation((id: string) => { if (id === 'boom') throw new Error('ls quota'); });
    let r!: ReturnType<typeof completeCommittedPhonePaymentWorkflows>;
    expect(() => { r = completeCommittedPhonePaymentWorkflows(['x', 'boom', 'y'], 'lan', 's9'); }).not.toThrow();
    expect(completeWorkflow).toHaveBeenCalledTimes(3);   // did NOT stop at 'boom'
    expect(r.completed).toBe(2);
    expect(r.failedIds).toEqual(['boom']);
  });

  it('calling twice with the same ids is safe (idempotent at the boundary)', () => {
    completeCommittedPhonePaymentWorkflows(['a', 'b'], 'local', 's1');
    const r2 = completeCommittedPhonePaymentWorkflows(['a', 'b'], 'local', 's1');
    expect(r2.attempted).toBe(2);
    expect(r2.failedIds).toEqual([]);
  });
});
