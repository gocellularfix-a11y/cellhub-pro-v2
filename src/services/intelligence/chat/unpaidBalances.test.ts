// ============================================================
// R-INTELLIGENCE-UNPAID-BALANCES-V1 — handler behavior.
// Executes handleUnpaidBalances against a minimal engine stub (only the four
// getters the handler reads) so the aggregation / sort / total / empty-state /
// executable-action paths are actually run, not just reasoned about.
// ============================================================

import { describe, it, expect } from 'vitest';
import { handleUnpaidBalances } from './unpaidBalances';
import type { IntelligenceEngine } from '../IntelligenceEngine';

// Minimal stub — only the methods handleUnpaidBalances touches.
function makeEngine(over: Partial<Record<'repairs' | 'layaways' | 'specialOrders' | 'unlocks', any[]>>): IntelligenceEngine {
  return {
    getRepairs: () => over.repairs ?? [],
    getLayaways: () => over.layaways ?? [],
    getSpecialOrders: () => over.specialOrders ?? [],
    getUnlocks: () => over.unlocks ?? [],
  } as unknown as IntelligenceEngine;
}

describe('handleUnpaidBalances', () => {
  it('returns a clean empty state when nothing is owed (no crash)', () => {
    const res = handleUnpaidBalances(makeEngine({}), 'en');
    expect(res.kind).toBe('answer');
    expect(res.text).toContain('No outstanding balances');
    expect(res.actions).toBeUndefined();
    expect(res.establishesContext).toBeUndefined();
  });

  it('excludes zero-balance and terminal-status records', () => {
    const engine = makeEngine({
      repairs: [
        { id: 'r1', customerName: 'Paid Pablo', balance: 0, status: 'completed', createdAt: '2026-01-01' },
        { id: 'r2', customerName: 'Cancel Carla', balance: 5000, status: 'cancelled', createdAt: '2026-01-01' },
        { id: 'r3', customerName: 'Refund Rosa', balance: 4000, status: 'refunded', createdAt: '2026-01-01' },
      ],
      layaways: [
        { id: 'l1', customerName: 'Forfeit Fer', balance: 3000, status: 'forfeited', createdAt: '2026-01-01' },
      ],
    });
    const res = handleUnpaidBalances(engine, 'en');
    expect(res.text).toContain('No outstanding balances');
  });

  it('aggregates across domains, sorts by highest balance, totals correctly', () => {
    const engine = makeEngine({
      repairs:  [{ id: 'r1', customerName: 'Ana',  customerPhone: '8050001111', balance: 2000, status: 'ready',    createdAt: '2026-01-01' }],
      layaways: [{ id: 'l1', customerName: 'Beto', customerPhone: '8050002222', balance: 9000, status: 'active',   createdAt: '2026-01-01' }],
      specialOrders: [{ id: 'o1', customerName: 'Caro', balance: 5000, status: 'received', createdAt: '2026-01-01' }],
      unlocks:  [{ id: 'u1', customerName: 'Dani', customerPhone: '8050004444', balance: 1500, status: 'pending', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'en');
    // Total = 2000 + 9000 + 5000 + 1500 = 17500 cents = $175.00
    expect(res.text).toContain('$175.00');
    expect(res.text).toContain('4 records owe');
    // Highest balance (Beto $90) must be listed first.
    const betoIdx = res.text.indexOf('Beto');
    const anaIdx = res.text.indexOf('Ana');
    expect(betoIdx).toBeGreaterThan(-1);
    expect(betoIdx).toBeLessThan(anaIdx);
    // Top record (layaway) anchors a customer context (no customerId → suppressed here).
    // Executable actions: open buttons + whatsapp where phone exists.
    const targets = (res.actions ?? []).map((a) => (a.payload as any).executionTarget);
    expect(targets).toContain('open_layaway');
    expect(targets).toContain('open_repair');
    expect(targets).toContain('open_special_order');
    expect(targets).toContain('open_unlock');
    expect(targets).toContain('whatsapp_url');
  });

  it('every open action carries the real entity id (never blank)', () => {
    const engine = makeEngine({
      repairs: [{ id: 'r-real-42', customerName: 'Eva', balance: 1200, status: 'in_progress', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'es');
    const openAct = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'open_repair');
    expect(openAct).toBeTruthy();
    expect((openAct!.payload as any).entityId).toBe('r-real-42');
    expect((openAct!.payload as any).executable).toBe(true);
  });
});
