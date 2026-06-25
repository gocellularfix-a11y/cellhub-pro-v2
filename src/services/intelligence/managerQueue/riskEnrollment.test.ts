import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ProactiveAction } from '@/services/intelligence/proactive/types';
import { enrollIntelligenceRisksToManagerQueue } from './riskEnrollment';
import { getQueue, resolveQueueItem } from './actions';

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
    title: over.title ?? 'Unpaid balance — Juan Perez',
    reason: over.reason ?? 'Customer owes $120 on a completed repair',
    recommendedAction: over.recommendedAction ?? 'Send a payment reminder',
    estimatedImpactCents: over.estimatedImpactCents ?? 12000,
    entityType: over.entityType ?? 'customer',
    entityId: over.entityId ?? 'cust-1',
    confidence: over.confidence ?? 0.9,
    createdAt: over.createdAt ?? 1,
  };
}

describe('enrollIntelligenceRisksToManagerQueue (R-INTEL-RISK-TO-QUEUE)', () => {
  it('enrolls a valid manager-worthy risk', () => {
    const s = enrollIntelligenceRisksToManagerQueue([action()]);
    expect(s).toMatchObject({ considered: 1, enrolled: 1, skippedDuplicate: 0, skippedResolved: 0, skippedInvalid: 0 });
    const q = getQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      status: 'pending',
      category: 'review',
      severity: 'high',
      title: 'Unpaid balance — Juan Perez',
      entityType: 'customer',
      entityId: 'cust-1',
    });
  });

  it('skips a duplicate (same fingerprint already pending) without inflating occurrenceCount', () => {
    enrollIntelligenceRisksToManagerQueue([action()]);
    const s = enrollIntelligenceRisksToManagerQueue([action()]);
    expect(s).toMatchObject({ considered: 1, enrolled: 0, skippedDuplicate: 1 });
    const q = getQueue();
    expect(q).toHaveLength(1);
    // Skipped, not merged — occurrenceCount must stay 1 (no per-render escalation).
    expect(q[0].occurrenceCount).toBe(1);
  });

  it('skips a risk whose item was already resolved (respects auto-resolution / dismissal)', () => {
    enrollIntelligenceRisksToManagerQueue([action()]);
    resolveQueueItem(getQueue()[0].id);
    const s = enrollIntelligenceRisksToManagerQueue([action()]);
    expect(s).toMatchObject({ considered: 1, enrolled: 0, skippedResolved: 1 });
    // No new pending item created.
    expect(getQueue().filter(i => i.status === 'pending')).toHaveLength(0);
  });

  it('skips an invalid action (missing title) silently', () => {
    const s = enrollIntelligenceRisksToManagerQueue([action({ title: '   ' })]);
    expect(s).toMatchObject({ considered: 1, enrolled: 0, skippedInvalid: 1 });
    expect(getQueue()).toHaveLength(0);
  });

  it('does not enroll medium-priority actions (not manager-worthy)', () => {
    const s = enrollIntelligenceRisksToManagerQueue([action({ priority: 'medium' })]);
    expect(s).toMatchObject({ considered: 0, enrolled: 0 });
    expect(getQueue()).toHaveLength(0);
  });

  it('caps enrollment per run', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      action({ id: `pa-${i}`, title: `Risk ${i}`, entityId: `cust-${i}` }),
    );
    const s = enrollIntelligenceRisksToManagerQueue(many, { cap: 2 });
    expect(s.considered).toBe(2);
    expect(s.enrolled).toBe(2);
    expect(getQueue()).toHaveLength(2);
  });

  it('does not throw on malformed input and returns a zeroed summary', () => {
    const garbage = [null, undefined, {}, { priority: 'high' }, 42, 'x'] as unknown as ProactiveAction[];
    let s!: ReturnType<typeof enrollIntelligenceRisksToManagerQueue>;
    expect(() => { s = enrollIntelligenceRisksToManagerQueue(garbage); }).not.toThrow();
    // Only { priority: 'high' } (no title) is considered → skippedInvalid.
    expect(s).toMatchObject({ enrolled: 0, considered: 1, skippedInvalid: 1 });
    expect(enrollIntelligenceRisksToManagerQueue(null)).toMatchObject({ considered: 0, enrolled: 0 });
    expect(enrollIntelligenceRisksToManagerQueue([])).toMatchObject({ considered: 0, enrolled: 0 });
  });
});
