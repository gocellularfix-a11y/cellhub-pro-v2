// ============================================================
// R-INTELLIGENCE-STABILIZE-1 T5 — entity safety characterization.
// Locks the gate that prevents follow-up actions from executing against a
// stale/missing entity: a reference to an entity not present in the current
// store data must be rejected.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  validateCustomerContext,
  validateRepairContext,
  validateOperationalContext,
} from './contextValidator';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperationalContext } from '../chat/intentRouter';

// Minimal engine stub — only the read getters the validator touches.
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

const fresh = (o: Partial<OperationalContext>): OperationalContext => ({
  type: 'customer',
  value: 'x',
  timestamp: Date.now(),
  ...o,
});

describe('entity safety (T2)', () => {
  it('rejects a customer context whose entity no longer exists in the store', () => {
    const engine = engineWith({ getCustomers: () => [] });
    expect(validateCustomerContext(engine, fresh({ type: 'customer', value: 'gone-id' })).valid).toBe(false);
  });

  it('accepts a customer context that matches by id or name', () => {
    const engine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan' }] });
    expect(validateCustomerContext(engine, fresh({ type: 'customer', value: 'c1' })).valid).toBe(true);
    expect(validateCustomerContext(engine, fresh({ type: 'customer', value: 'Juan' })).valid).toBe(true);
  });

  it('rejects a repair context when no repair carries that customerName', () => {
    const engine = engineWith({ getRepairs: () => [{ customerName: 'Ana' }] });
    expect(validateRepairContext(engine, fresh({ type: 'repair', value: 'Bob' })).valid).toBe(false);
    expect(validateRepairContext(engine, fresh({ type: 'repair', value: 'Ana' })).valid).toBe(true);
  });

  it('rejects null / undefined / wrong-shaped context', () => {
    const engine = engineWith({ getCustomers: () => [{ id: 'c1', name: 'Juan' }] });
    expect(validateCustomerContext(engine, null).valid).toBe(false);
    expect(validateCustomerContext(engine, undefined).valid).toBe(false);
    expect(validateOperationalContext(engine, fresh({ value: '' })).valid).toBe(false);
  });
});
