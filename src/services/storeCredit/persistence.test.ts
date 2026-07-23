// ============================================================
// P0-SC-1.1 — Restart persistence proof (audit MAJOR 1)
//
// Drives the REAL persistence layer (persist.storeCreditLedger →
// saveRecord → localSaveRecord → localStorage under 'cellhub_' prefix) and
// the REAL hydration read (loadLocal with the same 'store_credit_ledger'
// key useFirestore hydrates from), against an in-memory localStorage that
// is wiped between "sessions" only in RAM — the storage map survives,
// exactly like an app restart.
//
// Also pins the BLOCKER 3 store-scope mechanism: saveRecord auto-tags
// storeId on every ledger write (storeCreditLedger is NOT a global
// collection), which is what belongsToStore scoping consumes.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import type { StoreCreditLedger } from '@/store/types';

// In-memory localStorage — installed BEFORE importing the persistence layer.
const backing = new Map<string, string>();
beforeAll(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => { backing.set(k, String(v)); },
    removeItem: (k: string) => { backing.delete(k); },
    clear: () => { backing.clear(); },
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

describe('store credit ledger — restart persistence (real persist + hydration path)', () => {
  it('a debited certificate persists, survives "restart", and rehydrates at $169.70', async () => {
    const { persist } = await import('@/services/persist');
    const { loadLocal } = await import('@/services/storage');
    const { issueLedgerEntry, redeemLedgerEntry } = await import('./ledger');

    // Issue $232.70, redeem $63.00 (the owner scenario), persist the result.
    const issued = issueLedgerEntry({
      certificateNumber: 'SC-PERSIST-1', amountCents: 23270,
      customerId: 'c1', customerName: 'Jorge O', employeeName: 'Emp',
    });
    const { ledger: debited } = redeemLedgerEntry(issued, {
      amountCents: 6300, saleId: 'sale-63', invoiceNumber: 'INV-63', employeeName: 'Emp',
    });
    await persist.storeCreditLedger(debited.id, debited as unknown as Record<string, unknown>);

    // ── "Restart": in-memory state is gone; hydrate from the SAME key
    // useFirestore reads ('store_credit_ledger', 'cellhub_' prefix). ──
    const rehydrated = loadLocal<Record<string, unknown>[]>('store_credit_ledger', []);
    const entry = rehydrated.find((r) => r.id === debited.id) as unknown as StoreCreditLedger | undefined;
    expect(entry).toBeDefined();
    expect(entry!.remainingAmount).toBe(16970);   // $169.70 after restart — NOT $232.70
    expect(entry!.redeemedAmount).toBe(6300);
    expect(entry!.issuedAmount).toBe(23270);
    expect(entry!.status).toBe('active');
    expect(entry!.redemptions).toHaveLength(1);
    expect(entry!.redemptions[0].saleId).toBe('sale-63');

    // BLOCKER 3 mechanism: the persist layer auto-tagged the store scope.
    expect((entry as unknown as { storeId?: string }).storeId).toBe('default');
  });

  it('a second persisted debit accumulates on the SAME stored record (no duplicates)', async () => {
    const { persist } = await import('@/services/persist');
    const { loadLocal } = await import('@/services/storage');
    const { redeemLedgerEntry } = await import('./ledger');

    const stored = loadLocal<Record<string, unknown>[]>('store_credit_ledger', []);
    const current = stored.find((r) => (r as { certificateNumber?: string }).certificateNumber === 'SC-PERSIST-1') as unknown as StoreCreditLedger;
    const { ledger: after } = redeemLedgerEntry(current, {
      amountCents: 5000, saleId: 'sale-50', employeeName: 'Emp',
    });
    await persist.storeCreditLedger(after.id, after as unknown as Record<string, unknown>);

    const again = loadLocal<Record<string, unknown>[]>('store_credit_ledger', []);
    const entries = again.filter((r) => (r as { certificateNumber?: string }).certificateNumber === 'SC-PERSIST-1');
    expect(entries).toHaveLength(1);                                  // updated in place, not duplicated
    const entry = entries[0] as unknown as StoreCreditLedger;
    expect(entry.remainingAmount).toBe(11970);                        // $119.70
    expect(entry.redemptions.map((r) => r.saleId)).toEqual(['sale-63', 'sale-50']);
  });
});
