// ============================================================
// R-INTEL-V2-PHASE1 — AR collections "send reminder" behavior.
// Drives handleUnpaidBalances against a minimal engine stub and asserts the
// new reminder actions (WhatsApp reminder + Copy reminder), the deterministic
// EN/ES/PT reminder text, cents formatting, and that zero/terminal balances
// are still excluded. Also confirms unpaid_balances still routes correctly.
// ============================================================

import { describe, it, expect } from 'vitest';
import { handleUnpaidBalances } from './unpaidBalances';
import { classifyIntent } from './intentRouter';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer } from '@/store/types';

function makeEngine(over: Partial<Record<'repairs' | 'layaways' | 'specialOrders' | 'unlocks', any[]>>): IntelligenceEngine {
  return {
    getRepairs: () => over.repairs ?? [],
    getLayaways: () => over.layaways ?? [],
    getSpecialOrders: () => over.specialOrders ?? [],
    getUnlocks: () => over.unlocks ?? [],
  } as unknown as IntelligenceEngine;
}

const NO_CUSTOMERS: Customer[] = [];

// One repair, $45.00 owed (4500 cents), active status, has a phone.
const oneRepair = () =>
  makeEngine({
    repairs: [{
      id: 'r1', customerName: 'Ana Lopez', customerPhone: '8050001111',
      device: 'iPhone 12', balance: 4500, status: 'ready', createdAt: '2026-01-01',
    }],
  });

describe('handleUnpaidBalances — reminder actions', () => {
  it('adds both a WhatsApp reminder and a Copy reminder action per row', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    const targets = (res.actions ?? []).map((a) => (a.payload as any).executionTarget);
    expect(targets).toContain('open_repair');
    expect(targets).toContain('whatsapp_url');
    expect(targets).toContain('copy_to_clipboard');
  });

  it('WhatsApp reminder carries the deterministic message as customMessage', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    const wa = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'whatsapp_url');
    const msg = (wa!.payload as any).customMessage as string;
    expect(msg).toBeTruthy();
    expect(msg).toContain('Ana');           // greeting uses first name
    expect(msg).toContain('$45.00');        // integer cents → formatted
    expect(msg).toContain('repair');        // source type
  });

  it('reminder actions carry AR tracking metadata with integer-cents balance', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    for (const target of ['whatsapp_url', 'copy_to_clipboard']) {
      const act = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === target);
      const ar = (act!.payload as any).arReminder;
      expect(ar).toBeTruthy();
      expect(ar.entityType).toBe('repair');
      expect(ar.entityId).toBe('r1');
      expect(ar.balanceCents).toBe(4500);              // amount owed, as-is
      expect(Number.isInteger(ar.balanceCents)).toBe(true);
      expect(ar.language).toBe('en');
    }
  });

  it('Copy reminder carries the same message and needs no phone', () => {
    // Row with NO phone still gets a copy action (but no whatsapp action).
    const engine = makeEngine({
      unlocks: [{ id: 'u1', customerName: 'Beto', balance: 3000, status: 'pending', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'en');
    const targets = (res.actions ?? []).map((a) => (a.payload as any).executionTarget);
    expect(targets).toContain('copy_to_clipboard');
    expect(targets).not.toContain('whatsapp_url'); // no phone → no WhatsApp
    const copy = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((copy!.payload as any).customMessage).toContain('$30.00');
  });

  it('formats cents correctly for non-round amounts', () => {
    const engine = makeEngine({
      repairs: [{ id: 'r9', customerName: 'Cy', customerPhone: '8050009999', balance: 12399, status: 'ready', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'en');
    const copy = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((copy!.payload as any).customMessage).toContain('$123.99');
  });

  it('produces Spanish and Portuguese reminder text', () => {
    const es = (handleUnpaidBalances(oneRepair(), 'es').actions ?? [])
      .find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((es!.payload as any).customMessage).toContain('saldo de');
    expect((es!.payload as any).customMessage).toContain('reparación');

    const pt = (handleUnpaidBalances(oneRepair(), 'pt').actions ?? [])
      .find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((pt!.payload as any).customMessage).toContain('saldo de');
    expect((pt!.payload as any).customMessage).toContain('reparo');
  });

  it('still excludes zero-balance and terminal-status records (no actions)', () => {
    const engine = makeEngine({
      repairs: [
        { id: 'r1', customerName: 'Paid', balance: 0, status: 'completed', createdAt: '2026-01-01' },
        { id: 'r2', customerName: 'Void', balance: 5000, status: 'refunded', createdAt: '2026-01-01' },
      ],
    });
    const res = handleUnpaidBalances(engine, 'en');
    expect(res.text).toContain('No outstanding balances');
    expect(res.actions).toBeUndefined();
  });
});

describe('unpaid_balances routing still resolves', () => {
  it('routes AR phrases to unpaid_balances (EN/ES/PT)', () => {
    expect(classifyIntent('who owes me money', NO_CUSTOMERS, 'en').id).toBe('unpaid_balances');
    expect(classifyIntent('saldos pendientes', NO_CUSTOMERS, 'es').id).toBe('unpaid_balances');
    expect(classifyIntent('contas a receber', NO_CUSTOMERS, 'pt').id).toBe('unpaid_balances');
  });
});
