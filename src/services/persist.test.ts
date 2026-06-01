// ============================================================
// R-STABILIZE-1 T1 — Guards the persist merge-safety fix.
//
// Locks the contract: a PARTIAL saveRecord() must NOT erase fields that were
// present on the existing record. Before the fix, the local array branch did
// arr[idx] = record (full overwrite), so a partial update silently dropped
// every field absent from `data`. This test fails against the old behavior.
//
// localStorage is stubbed with a Map so the test runs in the `node` env
// (no jsdom dependency added).
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { saveRecord } from './persist';
import { loadLocal } from './storage';
import { COLLECTIONS } from '@/config/constants';

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

type Rec = Record<string, unknown>;

beforeEach(() => {
  (globalThis as { localStorage: unknown }).localStorage = new MockLocalStorage();
});

describe('saveRecord — local merge safety (T1)', () => {
  it('a partial update preserves fields not present in the patch', async () => {
    // Create a full record.
    await saveRecord(COLLECTIONS.repairs, 'r1', {
      id: 'r1',
      customerId: 'c1',
      price: 10000,
      deposit: 5000,
      status: 'active',
    });

    // Apply a partial update (only status changes).
    await saveRecord(COLLECTIONS.repairs, 'r1', { status: 'picked_up' });

    const arr = loadLocal<Rec[]>('repairs', []);
    const rec = arr.find((r) => r.id === 'r1') as Rec;

    expect(rec).toBeTruthy();
    // Overwritten field reflects the patch:
    expect(rec.status).toBe('picked_up');
    // Untouched fields survive (this is the regression that was fixed):
    expect(rec.customerId).toBe('c1');
    expect(rec.price).toBe(10000);
    expect(rec.deposit).toBe(5000);
    // id is preserved and updatedAt is set.
    expect(rec.id).toBe('r1');
    expect(typeof rec.updatedAt).toBe('string');
  });

  it('a new record is created cleanly with the provided fields', async () => {
    await saveRecord(COLLECTIONS.repairs, 'r2', { id: 'r2', status: 'active', price: 2500 });
    const arr = loadLocal<Rec[]>('repairs', []);
    const rec = arr.find((r) => r.id === 'r2') as Rec;
    expect(rec.status).toBe('active');
    expect(rec.price).toBe(2500);
    expect(rec.id).toBe('r2');
  });

  it('an explicit field overwrite still wins over the old value', async () => {
    await saveRecord(COLLECTIONS.repairs, 'r3', { id: 'r3', price: 10000, status: 'active' });
    await saveRecord(COLLECTIONS.repairs, 'r3', { price: 12000 });
    const arr = loadLocal<Rec[]>('repairs', []);
    const rec = arr.find((r) => r.id === 'r3') as Rec;
    expect(rec.price).toBe(12000); // overwritten
    expect(rec.status).toBe('active'); // preserved
  });
});
