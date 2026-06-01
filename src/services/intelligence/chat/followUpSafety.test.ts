// ============================================================
// R-INTELLIGENCE-STABILIZE-1 T5 — follow-up resolution safety (integration).
// Drives the real handleFollowUp() to lock:
//  - expired follow-up context is rejected (no entity action)
//  - a stale entity reference is rejected (no entity action)
//  - a valid, in-window entity reference still produces its action
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
  over: Partial<Record<'getCustomers' | 'getRepairs' | 'getInventory', () => unknown[]>>,
): IntelligenceEngine {
  return {
    getCustomers: () => [],
    getRepairs: () => [],
    getInventory: () => [],
    ...over,
  } as unknown as IntelligenceEngine;
}

const TTL = 30 * 60 * 1000;
const freshCtx = (intentId: string): FollowUpContext => ({ intentId, query: '', responseText: '', ts: Date.now() });

describe('handleFollowUp safety (T1 + T2)', () => {
  it('rejects an EXPIRED follow-up context with no action emitted', () => {
    const engine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan', phone: '555' }] });
    const expired: FollowUpContext = { intentId: 'best_customer', query: '', responseText: '', ts: Date.now() - (TTL + 60_000) };
    const opCtx: OperationalContext = { type: 'customer', value: 'c1', timestamp: Date.now() };
    const resp = handleFollowUp(expired, engine, 'en', opCtx, 'contact him');
    expect(resp.actions).toBeUndefined(); // safe downgrade — never an entity action
  });

  it('rejects a STALE entity reference (customer gone) with no action emitted', () => {
    const engine = engineWith({ getCustomers: () => [] }); // customer no longer exists
    const opCtx: OperationalContext = { type: 'customer', value: 'gone-id', timestamp: Date.now() };
    const resp = handleFollowUp(freshCtx('best_customer'), engine, 'en', opCtx, 'contact him');
    expect(resp.actions).toBeUndefined();
  });

  it('still produces the contact action for a VALID, in-window entity', () => {
    const engine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan', phone: '5551234' }] });
    const opCtx: OperationalContext = { type: 'customer', value: 'c1', timestamp: Date.now() };
    const resp = handleFollowUp(freshCtx('best_customer'), engine, 'en', opCtx, 'contact him');
    expect(resp.actions?.length).toBe(1);
    expect(resp.actions?.[0].payload.customerId).toBe('c1');
  });
});
