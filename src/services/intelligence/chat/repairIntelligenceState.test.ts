// ============================================================
// R-INTELLIGENCE-ENTITY-VALIDATION-TIER2 — repair outreach state safety.
// Drives the real handleRepairFollowUp() / handleRepairEscalate() to lock the
// one reachable Tier 2 gap: the active-selection filter (!isDoneRepairStatus)
// excludes picked_up/cancelled/refunded but NOT refund_pending, so a
// refund_pending repair could still receive a follow-up / escalation action.
// The new validateResolvedEntity guard must reject it (and keep rejecting the
// already-filtered terminal states), while valid active repairs still produce
// their action.
// ============================================================

import { describe, it, expect } from 'vitest';
import { handleRepairFollowUp, handleRepairEscalate } from './repairIntelligence';
import type { IntentMatch } from './intentRouter';
import type { IntelligenceEngine } from '../IntelligenceEngine';

function engineWith(repairs: unknown[]): IntelligenceEngine {
  return {
    getRepairs: () => repairs,
    getCustomers: () => [],
    getLayaways: () => [],
    getInventory: () => [],
  } as unknown as IntelligenceEngine;
}

// Handlers only read match.extractedName; undefined → oldest-active selection.
const noNameMatch = (): IntentMatch => ({} as unknown as IntentMatch);

const repair = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1',
  customerName: 'Ana',
  customerId: 'c1',
  customerPhone: '5551234',
  device: 'iPhone 12',
  issue: 'screen',
  status: 'in_progress',
  createdAt: Date.now(),
  estimatedCost: 10000,
  ...over,
});

describe('handleRepairFollowUp — Tier2 state guard', () => {
  it('1. refund_pending repair blocks the follow-up action', () => {
    const engine = engineWith([repair({ status: 'refund_pending' })]);
    const resp = handleRepairFollowUp(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
  });

  it('3. active repair still creates the follow-up action', () => {
    const engine = engineWith([repair({ status: 'in_progress' })]);
    const resp = handleRepairFollowUp(noNameMatch(), engine, 'en');
    expect((resp.actions?.length ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('5. no repairs returns the existing noRepair behavior (no action)', () => {
    const engine = engineWith([]);
    const resp = handleRepairFollowUp(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
  });

  it('6. cancelled repair remains blocked', () => {
    const engine = engineWith([repair({ status: 'cancelled' })]);
    const resp = handleRepairFollowUp(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
  });

  it('7. picked_up repair remains blocked', () => {
    const engine = engineWith([repair({ status: 'picked_up' })]);
    const resp = handleRepairFollowUp(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
  });

  it('refunded repair remains blocked', () => {
    const engine = engineWith([repair({ status: 'refunded' })]);
    const resp = handleRepairFollowUp(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
  });
});

describe('handleRepairEscalate — Tier2 state guard', () => {
  it('2. refund_pending repair blocks the escalation action', () => {
    const engine = engineWith([repair({ status: 'refund_pending' })]);
    const resp = handleRepairEscalate(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
  });

  it('4. active repair still creates the escalation action', () => {
    const engine = engineWith([repair({ status: 'in_progress' })]);
    const resp = handleRepairEscalate(noNameMatch(), engine, 'en');
    expect((resp.actions?.length ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('refund_pending escalation: no fake success — safe text, no action', () => {
    const engine = engineWith([repair({ status: 'refund_pending' })]);
    const resp = handleRepairEscalate(noNameMatch(), engine, 'en');
    expect(resp.actions).toBeUndefined();
    expect(typeof resp.text).toBe('string');
    expect((resp.text || '').length).toBeGreaterThan(0);
  });
});
