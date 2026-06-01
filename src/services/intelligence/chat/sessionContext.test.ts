// ============================================================
// R-INTELLIGENCE-STABILIZE-1 T5 — session-context TTL characterization.
// Locks: (a) the 30-min TTL predicate, (b) a fresh context is returned,
// (c) an all-expired store is actively PURGED (not just ignored) so stale
// context cannot survive longer than intended.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushSessionContext,
  getSessionContext,
  isSessionEntryExpired,
} from './sessionContext';

const STORAGE_KEY = 'cellhub:intelligence:sessionCtx:v1';

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

describe('session context TTL (T1)', () => {
  it('isSessionEntryExpired respects the 30-minute window', () => {
    const now = Date.now();
    expect(isSessionEntryExpired(now - 29 * 60 * 1000, now)).toBe(false);
    expect(isSessionEntryExpired(now - 31 * 60 * 1000, now)).toBe(true);
  });

  it('returns a freshly pushed context', () => {
    pushSessionContext({ lastIntent: 'best_customer', lastCustomerId: 'c1' });
    expect(getSessionContext()?.lastIntent).toBe('best_customer');
  });

  it('purges an all-expired store and returns null (stale context cannot survive)', () => {
    const stale = [{ lastIntent: 'open_repair', timestamp: Date.now() - 60 * 60 * 1000 }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    expect(getSessionContext()).toBeNull();
    // The stale blob must have been actively removed, not merely ignored.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
