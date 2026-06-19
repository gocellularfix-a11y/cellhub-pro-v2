// ============================================================
// R-ENTITY-VALIDATION-V1 — validateResolvedEntity behavior.
//
// Drives the validator against a minimal store stub so each branch actually
// runs: existence, terminal-state, and reason-code mapping for the highest-risk
// action entities (customer, repair, layaway, inventory). A failing result is
// the gate — the GOER caller returns a safe message (no action) on !ok.
// ============================================================

import { describe, it, expect } from 'vitest';
import { validateResolvedEntity, type EntityValidationStore } from './validateResolvedEntity';
import type { ResolvedEntity } from './types';

function store(over: Partial<Record<'customers' | 'repairs' | 'layaways' | 'inventory', any[]>> = {}): EntityValidationStore {
  return {
    getCustomers: () => (over.customers ?? []) as any,
    getRepairs:   () => (over.repairs ?? []) as any,
    getLayaways:  () => (over.layaways ?? []) as any,
    getInventory: () => (over.inventory ?? []) as any,
  };
}

const customer = (id: string): ResolvedEntity => ({ type: 'customer', customerId: id, confidence: 0.9 });
const repair   = (id: string): ResolvedEntity => ({ type: 'repair', repairId: id, confidence: 0.9 });
const layaway  = (id: string): ResolvedEntity => ({ type: 'layaway', layawayId: id, confidence: 0.9 });
const inventory = (sku: string): ResolvedEntity => ({ type: 'inventory', sku, confidence: 0.9 });

describe('validateResolvedEntity — customer', () => {
  it('valid customer (match by id) passes', () => {
    const r = validateResolvedEntity(customer('c1'), store({ customers: [{ id: 'c1', name: 'Ana' }] }));
    expect(r).toEqual({ ok: true, type: 'customer', id: 'c1' });
  });

  it('valid customer (match by phone) passes', () => {
    const r = validateResolvedEntity(customer('8050001111'), store({ customers: [{ id: 'c9', phone: '8050001111' }] }));
    expect(r.ok).toBe(true);
  });

  it('missing customer blocks with not_found', () => {
    const r = validateResolvedEntity(customer('ghost'), store({ customers: [{ id: 'c1' }] }));
    expect(r).toEqual({ ok: false, type: 'customer', id: 'ghost', reason: 'not_found' });
  });

  it('deleted/archived customer blocks with deleted', () => {
    const r = validateResolvedEntity(customer('c1'), store({ customers: [{ id: 'c1', deleted: true }] }));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('deleted');
  });
});

describe('validateResolvedEntity — repair', () => {
  it('active repair passes', () => {
    const r = validateResolvedEntity(repair('r1'), store({ repairs: [{ id: 'r1', status: 'in_progress' }] }));
    expect(r.ok).toBe(true);
  });

  it('cancelled repair blocks with cancelled', () => {
    const r = validateResolvedEntity(repair('r1'), store({ repairs: [{ id: 'r1', status: 'cancelled' }] }));
    expect((r as any).reason).toBe('cancelled');
    expect(r.ok).toBe(false);
  });

  it('refunded repair blocks with cancelled', () => {
    const r = validateResolvedEntity(repair('r1'), store({ repairs: [{ id: 'r1', status: 'refunded' }] }));
    expect((r as any).reason).toBe('cancelled');
  });

  it('picked-up repair blocks with completed', () => {
    const r = validateResolvedEntity(repair('r1'), store({ repairs: [{ id: 'r1', status: 'picked_up' }] }));
    expect((r as any).reason).toBe('completed');
  });

  it('missing repair blocks with not_found', () => {
    const r = validateResolvedEntity(repair('nope'), store({ repairs: [{ id: 'r1', status: 'ready' }] }));
    expect((r as any).reason).toBe('not_found');
  });
});

describe('validateResolvedEntity — layaway', () => {
  it('active layaway passes', () => {
    const r = validateResolvedEntity(layaway('l1'), store({ layaways: [{ id: 'l1', status: 'active' }] }));
    expect(r.ok).toBe(true);
  });

  it('completed layaway blocks with completed', () => {
    const r = validateResolvedEntity(layaway('l1'), store({ layaways: [{ id: 'l1', status: 'completed' }] }));
    expect((r as any).reason).toBe('completed');
  });

  it('cancelled/forfeited layaway blocks with cancelled', () => {
    const r = validateResolvedEntity(layaway('l1'), store({ layaways: [{ id: 'l1', status: 'forfeited' }] }));
    expect((r as any).reason).toBe('cancelled');
  });

  it('missing layaway blocks with not_found', () => {
    const r = validateResolvedEntity(layaway('x'), store({ layaways: [] }));
    expect((r as any).reason).toBe('not_found');
  });
});

describe('validateResolvedEntity — inventory + sale', () => {
  it('inventory by sku passes', () => {
    const r = validateResolvedEntity(inventory('SKU-1'), store({ inventory: [{ id: 'i1', sku: 'SKU-1' }] }));
    expect(r.ok).toBe(true);
  });

  it('missing inventory blocks with not_found', () => {
    const r = validateResolvedEntity(inventory('SKU-9'), store({ inventory: [{ id: 'i1', sku: 'SKU-1' }] }));
    expect((r as any).reason).toBe('not_found');
  });

  it('sale is unsupported (no executable action to guard)', () => {
    const r = validateResolvedEntity({ type: 'sale', saleId: 's1', confidence: 0.9 }, store());
    expect(r).toEqual({ ok: false, type: 'sale', id: 's1', reason: 'unsupported' });
  });
});

describe('validateResolvedEntity — no action contract', () => {
  it('every failure is ok:false so the caller never builds an executable action', () => {
    const failures = [
      validateResolvedEntity(customer('ghost'), store()),
      validateResolvedEntity(repair('ghost'), store()),
      validateResolvedEntity(layaway('ghost'), store()),
      validateResolvedEntity(inventory('ghost'), store()),
    ];
    for (const f of failures) expect(f.ok).toBe(false);
  });
});
