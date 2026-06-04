// ============================================================
// R-INTELLIGENCE-REPAIR-PICKUP-DETAILS-V1 — handler behavior.
// Drives handleRepairsReady against a minimal engine stub (only getRepairs)
// so the detail rows, per-repair actions, guards, and empty/overflow states
// actually run — not just reasoned about.
// ============================================================

import { describe, it, expect } from 'vitest';
import { handleRepairsReady } from './repairsReady';
import type { IntelligenceEngine } from '../IntelligenceEngine';

const NOW = new Date('2026-06-04T12:00:00').getTime();

function engineWith(repairs: any[]): IntelligenceEngine {
  return { getRepairs: () => repairs } as unknown as IntelligenceEngine;
}

const repair = (over: Record<string, unknown>) => ({
  id: 'r1', customerName: 'Maria Lopez', customerPhone: '8050001111',
  device: 'iPhone 13', issue: 'Screen replacement', status: 'ready',
  balance: 8999, createdAt: '2026-06-01', ...over,
});

describe('handleRepairsReady', () => {
  it('zero ready → clear empty state, no actions', () => {
    const res = handleRepairsReady(engineWith([
      repair({ id: 'p1', status: 'picked_up' }),
      repair({ id: 'c1', status: 'in_progress' }),
    ]), 'en', NOW);
    expect(res.text).toContain('No repairs ready for pickup');
    expect(res.actions).toBeUndefined();
  });

  it('includes customer, device, service, ticket, and balance details', () => {
    const res = handleRepairsReady(engineWith([repair({})]), 'en', NOW);
    expect(res.text).toContain('Maria Lopez');
    expect(res.text).toContain('iPhone 13');
    expect(res.text).toContain('Screen replacement');
    expect(res.text).toContain('#'); // ticket short id
    expect(res.text).toContain('$89.99'); // balance
  });

  it('renders an Open Repair action carrying the real repair id', () => {
    const res = handleRepairsReady(engineWith([repair({ id: 'r-real-42' })]), 'en', NOW);
    const open = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'open_repair');
    expect(open).toBeTruthy();
    expect((open!.payload as any).entityId).toBe('r-real-42');
    expect((open!.payload as any).executable).toBe(true);
  });

  it('renders a WhatsApp action only when a phone exists', () => {
    const withPhone = handleRepairsReady(engineWith([repair({ id: 'a', customerPhone: '8051234567' })]), 'es', NOW);
    expect((withPhone.actions ?? []).some((a) => (a.payload as any).executionTarget === 'whatsapp_url')).toBe(true);

    const noPhone = handleRepairsReady(engineWith([repair({ id: 'b', customerPhone: '' })]), 'es', NOW);
    expect((noPhone.actions ?? []).some((a) => (a.payload as any).executionTarget === 'whatsapp_url')).toBe(false);
    // …but Open Repair is still present (id exists).
    expect((noPhone.actions ?? []).some((a) => (a.payload as any).executionTarget === 'open_repair')).toBe(true);
  });

  it('does NOT render Open Repair when the repair id is missing', () => {
    const res = handleRepairsReady(engineWith([repair({ id: '', customerPhone: '' })]), 'en', NOW);
    expect((res.actions ?? []).some((a) => (a.payload as any).executionTarget === 'open_repair')).toBe(false);
  });

  it('caps at 5 rows and reports "Showing 5 of X"', () => {
    const many = Array.from({ length: 8 }, (_, i) => repair({ id: `r${i}`, customerName: `Cust ${i}` }));
    const res = handleRepairsReady(engineWith(many), 'en', NOW);
    expect(res.text).toContain('Showing 5 of 8');
    // header reflects the full count, rows are capped
    expect(res.text).toContain('8 repairs ready');
    // at most 10 actions (5 × open+whatsapp)
    expect((res.actions ?? []).length).toBeLessThanOrEqual(10);
  });

  it('uses the clean action copy, not the vague one', () => {
    const res = handleRepairsReady(engineWith([repair({})]), 'en', NOW);
    expect(res.text).toContain('Open a repair to confirm details');
    expect(res.text).not.toContain('Send pickup reminders via WhatsApp');
  });
});
