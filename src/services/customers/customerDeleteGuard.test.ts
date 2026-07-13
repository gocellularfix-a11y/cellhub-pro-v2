// ============================================================
// R-CUSTOMER-DELETE-FIX-V1 — delete-guard evaluation.
// The reported production bug: pressing the red Delete button did
// nothing. Root cause was in the dialog state flow (deleteConfirm was
// cleared while the warning dialog was being raised, so the second
// confirm had no id and silently closed). These tests lock the pure
// decision layer the fixed flow is built on: missing → explicit result,
// warnings → structured reasons, ok → deletable; and they document that
// deletion NEVER cascades into historical records by design.
// ============================================================

import { describe, it, expect } from 'vitest';
import { evaluateCustomerDelete } from './customerDeleteGuard';
import type { Customer, Repair, Layaway, Unlock } from '@/store/types';

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1', phone: '8051234567', name: 'Test Person',
  firstName: 'Test', lastName: 'Person', email: '',
  loyaltyPoints: 0, storeCredit: 0, customerNumber: 'GC-1',
  notes: '', communicationConsent: false,
  ...over,
} as Customer);

const none = { repairs: [] as Repair[], layaways: [] as Layaway[], unlocks: [] as Unlock[] };

describe('evaluateCustomerDelete', () => {
  it('missing customer → explicit missing result (never a silent no-op)', () => {
    expect(evaluateCustomerDelete('ghost', [customer()], none)).toEqual({ kind: 'missing' });
  });

  it('clean disposable customer → ok (deletable) with the right record', () => {
    const r = evaluateCustomerDelete('c1', [customer()], none);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.customer.id).toBe('c1');
  });

  it('store credit and loyalty produce structured warnings', () => {
    const r = evaluateCustomerDelete('c1', [customer({ storeCredit: 2500, loyaltyPoints: 10 })], none);
    expect(r.kind).toBe('warn');
    if (r.kind === 'warn') {
      expect(r.warnings).toContainEqual({ type: 'store_credit', amountCents: 2500 });
      expect(r.warnings).toContainEqual({ type: 'loyalty', points: 10 });
    }
  });

  it('active linked records warn with their category (by id or phone match)', () => {
    const linked = {
      repairs: [
        { id: 'r1', customerId: 'c1', customerPhone: '', status: 'in_progress' },
        { id: 'r2', customerId: 'other', customerPhone: '(805) 123-4567', status: 'received' }, // phone match
        { id: 'r3', customerId: 'c1', customerPhone: '', status: 'completed' },                 // terminal — not counted
      ] as unknown as Repair[],
      layaways: [{ id: 'l1', customerId: 'c1', customerPhone: '', status: 'active' }] as unknown as Layaway[],
      unlocks: [{ id: 'u1', customerId: 'c1', customerPhone: '', status: 'pending' }] as unknown as Unlock[],
    };
    const r = evaluateCustomerDelete('c1', [customer()], linked);
    expect(r.kind).toBe('warn');
    if (r.kind === 'warn') {
      expect(r.warnings).toContainEqual({ type: 'active_repairs', count: 2 });
      expect(r.warnings).toContainEqual({ type: 'active_layaways', count: 1 });
      expect(r.warnings).toContainEqual({ type: 'active_unlocks', count: 1 });
    }
  });

  it('terminal linked records do NOT warn (history never blocks, never cascades)', () => {
    const linked = {
      repairs: [{ id: 'r1', customerId: 'c1', customerPhone: '', status: 'completed' }] as unknown as Repair[],
      layaways: [{ id: 'l1', customerId: 'c1', customerPhone: '', status: 'completed' }] as unknown as Layaway[],
      unlocks: [{ id: 'u1', customerId: 'c1', customerPhone: '', status: 'cancelled' }] as unknown as Unlock[],
    };
    // Historical records stay in their own collections regardless of the
    // customer delete (remove.customer touches ONLY the customers key) —
    // the guard confirms they don't even warn once terminal.
    expect(evaluateCustomerDelete('c1', [customer()], linked).kind).toBe('ok');
  });

  it('is pure — inputs are not mutated', () => {
    const customers = [customer({ storeCredit: 100 })];
    const snapshot = JSON.stringify(customers);
    evaluateCustomerDelete('c1', customers, none);
    expect(JSON.stringify(customers)).toBe(snapshot);
  });
});
