// ============================================================
// R-INTELLIGENCE-ENTITY-VALIDATION-TIER1 — follow-up state-aware safety.
// Drives the real handleFollowUp() to lock the upgrade from existence-only to
// STATE-AWARE validation on the contact/open follow-up paths:
//   - a customer that still EXISTS but is deleted/archived is rejected
//   - a repair that still EXISTS but is cancelled/refunded/refund_pending/
//     picked_up is rejected
//   - valid active customer/repair still produce their action (no regression)
//   - no fake success: rejection returns the safe stale message, no action
//
// Repair contexts are keyed by customerName (value: repair.customerName), which
// is exactly how repairIntelligence.ts establishes a repair follow-up context.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { handleFollowUp, type FollowUpContext } from './handlers';
import type { OperationalContext } from './intentRouter';
import type { IntelligenceEngine } from '../IntelligenceEngine';

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? (this.store.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  get length(): number { return this.store.size; }
}

beforeEach(() => {
  (globalThis as { localStorage: unknown }).localStorage = new MockLocalStorage();
});

function engineWith(
  over: Partial<Record<'getCustomers' | 'getRepairs' | 'getInventory' | 'getLayaways', () => unknown[]>>,
): IntelligenceEngine {
  return {
    getCustomers: () => [],
    getRepairs: () => [],
    getInventory: () => [],
    getLayaways: () => [],
    ...over,
  } as unknown as IntelligenceEngine;
}

const freshCtx = (intentId: string): FollowUpContext => ({ intentId, query: '', responseText: '', ts: Date.now() });
const custCtx = (value: string): OperationalContext => ({ type: 'customer', value, timestamp: Date.now() });
const repairCtx = (value: string): OperationalContext => ({ type: 'repair', value, timestamp: Date.now() });

describe('handleFollowUp Tier1 — customer state validation', () => {
  it('1. rejects a MISSING customer follow-up safely (no action)', () => {
    const engine = engineWith({ getCustomers: () => [] });
    const resp = handleFollowUp(freshCtx('best_customer'), engine, 'en', custCtx('gone-id'), 'contact him');
    expect(resp.actions).toBeUndefined();
  });

  it('2. rejects a DELETED/ARCHIVED customer follow-up safely (exists but removed)', () => {
    // Customer EXISTS (existence check passes) but is flagged deleted → state guard rejects.
    const engine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan', phone: '5551234', deleted: true }] });
    const resp = handleFollowUp(freshCtx('best_customer'), engine, 'en', custCtx('c1'), 'contact him');
    expect(resp.actions).toBeUndefined();
  });

  it('6. still builds the contact action for a VALID active customer', () => {
    const engine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan', phone: '5551234' }] });
    const resp = handleFollowUp(freshCtx('best_customer'), engine, 'en', custCtx('c1'), 'contact him');
    expect(resp.actions?.length).toBe(1);
    expect(resp.actions?.[0].payload.customerId).toBe('c1');
  });

  it('8. no fake success when the customer disappeared — same safe stale message, no action', () => {
    const goneEngine = engineWith({ getCustomers: () => [] });
    const deletedEngine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan', phone: '5551234', deleted: true }] });
    const goneResp = handleFollowUp(freshCtx('best_customer'), goneEngine, 'en', custCtx('c1'), 'open it');
    const deletedResp = handleFollowUp(freshCtx('best_customer'), deletedEngine, 'en', custCtx('c1'), 'open it');
    expect(goneResp.actions).toBeUndefined();
    expect(deletedResp.actions).toBeUndefined();
    // Deleted (exists-but-removed) takes the SAME safe path as fully missing.
    expect(deletedResp.text).toBe(goneResp.text);
    expect(typeof deletedResp.text).toBe('string');
    expect((deletedResp.text || '').length).toBeGreaterThan(0);
  });
});

describe('handleFollowUp Tier1 — repair state validation', () => {
  it('3. rejects a MISSING repair follow-up safely (no action)', () => {
    const engine = engineWith({ getRepairs: () => [] });
    const resp = handleFollowUp(freshCtx('repairs_ready'), engine, 'en', repairCtx('Ana'), 'open it');
    expect(resp.actions).toBeUndefined();
  });

  it('4. rejects a CANCELLED repair follow-up safely (exists but terminal)', () => {
    const engine = engineWith({ getRepairs: () => [{ id: 'r1', customerName: 'Ana', status: 'cancelled' }] });
    const resp = handleFollowUp(freshCtx('repairs_ready'), engine, 'en', repairCtx('Ana'), 'open it');
    expect(resp.actions).toBeUndefined();
  });

  it('4b. rejects a REFUNDED repair follow-up safely', () => {
    const engine = engineWith({ getRepairs: () => [{ id: 'r1', customerName: 'Ana', status: 'refunded' }] });
    const resp = handleFollowUp(freshCtx('repairs_ready'), engine, 'en', repairCtx('Ana'), 'open it');
    expect(resp.actions).toBeUndefined();
  });

  it('5. rejects a PICKED_UP/completed repair follow-up safely', () => {
    const engine = engineWith({ getRepairs: () => [{ id: 'r1', customerName: 'Ana', status: 'picked_up' }] });
    const resp = handleFollowUp(freshCtx('repairs_ready'), engine, 'en', repairCtx('Ana'), 'open it');
    expect(resp.actions).toBeUndefined();
  });

  it('7. still builds the open action for a VALID active repair', () => {
    const engine = engineWith({ getRepairs: () => [{ id: 'r1', customerName: 'Ana', status: 'in_progress' }] });
    const resp = handleFollowUp(freshCtx('repairs_ready'), engine, 'en', repairCtx('Ana'), 'open it');
    expect(resp.actions?.length).toBe(1);
    expect(resp.actions?.[0].payload.executionTarget).toBe('open_repair');
  });
});
