import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ProactiveAction } from '@/services/intelligence/proactive/types';
import type { EntityValidationStore } from '@/services/intelligence/oce/entityResolution/validateResolvedEntity';
import { enrollIntelligenceRisksToManagerQueue } from './riskEnrollment';
import { getQueue } from './actions';

// R-INTELLIGENCE-ENTITY-VALIDATION-TIER3 — proves that proactive risks are
// re-validated against LIVE store state immediately before queue enrollment.
// A risk valid at scan time but now pointing to a stale/missing entity must be
// DROPPED (never persisted), while valid entities still enroll normally. The
// pre-Tier3 contract (no store supplied → no revalidation) must be preserved.

// vitest runs in `node` env (no localStorage). The manager-queue store is
// localStorage-backed, so install a deterministic in-memory shim per test.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

function action(over: Partial<ProactiveAction> = {}): ProactiveAction {
  return {
    id: over.id ?? 'pa-1',
    category: over.category ?? 'collection',
    priority: over.priority ?? 'high',
    title: over.title ?? 'Collect balance',
    reason: over.reason ?? 'Customer owes a balance',
    recommendedAction: over.recommendedAction ?? 'Send a reminder',
    estimatedImpactCents: over.estimatedImpactCents ?? 12000,
    entityType: over.entityType ?? 'repair',
    entityId: over.entityId ?? 'rep-1',
    confidence: over.confidence ?? 0.9,
    createdAt: over.createdAt ?? 1,
  };
}

// Minimal live-store stub. The validator only reads id/status/phone/sku and the
// deleted/archived flags, so loosely-typed records are sufficient.
function makeStore(over: Partial<{
  customers: unknown[];
  repairs: unknown[];
  layaways: unknown[];
  inventory: unknown[];
}> = {}): EntityValidationStore {
  return {
    getCustomers: () => (over.customers ?? []) as never,
    getRepairs: () => (over.repairs ?? []) as never,
    getLayaways: () => (over.layaways ?? []) as never,
    getInventory: () => (over.inventory ?? []) as never,
  };
}

describe('enrollIntelligenceRisksToManagerQueue — Tier3 entity revalidation', () => {
  it('does NOT enroll a repair that went cancelled before enrollment', () => {
    const store = makeStore({ repairs: [{ id: 'rep-1', status: 'cancelled' }] });
    const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'repair', entityId: 'rep-1' })], { store });
    expect(s).toMatchObject({ considered: 1, enrolled: 0, skippedStale: 1 });
    // No placeholder / fake queue record is created for the stale entity.
    expect(getQueue()).toHaveLength(0);
  });

  it.each(['refunded', 'refund_pending', 'picked_up'])(
    'does NOT enroll a repair in terminal/refund state "%s"',
    (status) => {
      const store = makeStore({ repairs: [{ id: 'rep-1', status }] });
      const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'repair', entityId: 'rep-1' })], { store });
      expect(s).toMatchObject({ enrolled: 0, skippedStale: 1 });
      expect(getQueue()).toHaveLength(0);
    },
  );

  it('DOES enroll a repair still in an actionable state', () => {
    const store = makeStore({ repairs: [{ id: 'rep-1', status: 'ready' }] });
    const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'repair', entityId: 'rep-1' })], { store });
    expect(s).toMatchObject({ considered: 1, enrolled: 1, skippedStale: 0 });
    const q = getQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ entityType: 'repair', entityId: 'rep-1', status: 'pending' });
  });

  it('does NOT enroll a customer that no longer exists (missing)', () => {
    const store = makeStore({ customers: [] });
    const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'customer', entityId: 'cust-x' })], { store });
    expect(s).toMatchObject({ enrolled: 0, skippedStale: 1 });
    expect(getQueue()).toHaveLength(0);
  });

  it('does NOT enroll a customer flagged deleted/archived', () => {
    const store = makeStore({ customers: [{ id: 'cust-1', deleted: true }] });
    const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'customer', entityId: 'cust-1' })], { store });
    expect(s).toMatchObject({ enrolled: 0, skippedStale: 1 });
    expect(getQueue()).toHaveLength(0);
  });

  it('DOES enroll an existing, non-deleted customer', () => {
    const store = makeStore({ customers: [{ id: 'cust-1' }] });
    const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'customer', entityId: 'cust-1' })], { store });
    expect(s).toMatchObject({ enrolled: 1, skippedStale: 0 });
    expect(getQueue()).toHaveLength(1);
  });

  it('does NOT enroll a missing inventory item but DOES enroll an existing one', () => {
    const stale = enrollIntelligenceRisksToManagerQueue(
      [action({ entityType: 'inventory', entityId: 'sku-x', title: 'Restock A' })],
      { store: makeStore({ inventory: [] }) },
    );
    expect(stale).toMatchObject({ enrolled: 0, skippedStale: 1 });

    const ok = enrollIntelligenceRisksToManagerQueue(
      [action({ entityType: 'inventory', entityId: 'sku-1', title: 'Restock B' })],
      { store: makeStore({ inventory: [{ id: 'sku-1' }] }) },
    );
    expect(ok).toMatchObject({ enrolled: 1, skippedStale: 0 });
  });

  it('passes through entity types with no validator path (sale) even when a store is supplied', () => {
    // 'sale' is unsupported by the canonical validator (no executable action),
    // so Tier3 must NOT drop it — pre-Tier3 enrollment behavior is preserved.
    const store = makeStore({});
    const s = enrollIntelligenceRisksToManagerQueue(
      [action({ entityType: 'sale', entityId: 'sale-1', title: 'Review sale' })],
      { store },
    );
    expect(s).toMatchObject({ enrolled: 1, skippedStale: 0 });
    expect(getQueue()).toHaveLength(1);
  });

  it('preserves pre-Tier3 behavior when no store is supplied (no revalidation)', () => {
    // Same cancelled repair, but WITHOUT a store: enrollment proceeds exactly as
    // before Tier3 — backward compatible with all existing callers/tests.
    const s = enrollIntelligenceRisksToManagerQueue([action({ entityType: 'repair', entityId: 'rep-1' })]);
    expect(s).toMatchObject({ considered: 1, enrolled: 1, skippedStale: 0 });
    expect(getQueue()).toHaveLength(1);
  });
});
