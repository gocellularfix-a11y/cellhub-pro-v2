// ============================================================
// R-INTELLIGENCE-REGRESSION-GUARD-V1 — action safety + dedupe + no-context.
//
// TASK 2: executable "open entity" actions open the REAL entity by id and,
//   when the id is missing, return a safe no-op — NEVER a blank/new-creation
//   modal (the executor simply doesn't dispatch an open event).
// TASK 1 #9: follow-up commands with no valid context return the safe
//   no-context message and emit NO entity action.
// TASK 1 #10: proactive_operations never renders two buttons that do the same
//   thing (same executionTarget + entity).
//
// No money/tax/receipt logic is touched — these assert routing/navigation
// safety only.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeActionPayload } from '../actions/actionExecutor';
import type { ActionPayload } from '../actions/actionEngine';
import { handleFollowUp, handleIntent, type FollowUpContext } from './handlers';
import type { IntentMatch, OperationalContext } from './intentRouter';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ProactiveAction } from '../proactive/types';

// ── window / CustomEvent stubs (vitest env is 'node') ──
let dispatched: Array<{ type: string; detail: unknown }>;
beforeEach(() => {
  dispatched = [];
  // Minimal CustomEvent + window so the executor's dispatch path runs.
  (globalThis as any).CustomEvent = class {
    type: string; detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; }
  };
  (globalThis as any).window = {
    dispatchEvent: (e: { type: string; detail: unknown }) => { dispatched.push({ type: e.type, detail: e.detail }); return true; },
  };
});

// ── TASK 2 — open-by-id vs missing-id safety ──
describe('R-REGRESSION: open-entity actions open by id, never a blank modal', () => {
  const CASES: Array<{
    target: ActionPayload['executionTarget'];
    event: string;
    detailKey: string;
  }> = [
    { target: 'open_repair',        event: 'cellhub:open-repair',        detailKey: 'repairId' },
    { target: 'open_layaway',       event: 'cellhub:open-layaway',       detailKey: 'layawayId' },
    { target: 'open_unlock',        event: 'cellhub:open-unlock',        detailKey: 'unlockId' },
    { target: 'open_special_order', event: 'cellhub:open-special-order', detailKey: 'orderId' },
    { target: 'open_customer',      event: 'cellhub:open-customer',      detailKey: 'customerId' },
  ];

  for (const c of CASES) {
    it(`${c.target}: existing id dispatches the open event with that id`, () => {
      const payload = { type: 'review', entityId: 'real-123', executable: true, executionTarget: c.target } as ActionPayload;
      const res = executeActionPayload(payload);
      expect(res.ok).toBe(true);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].type).toBe(c.event);
      expect((dispatched[0].detail as Record<string, string>)[c.detailKey]).toBe('real-123');
    });

    it(`${c.target}: missing id is a safe no-op (no open event, no blank modal)`, () => {
      const payload = { type: 'review', executable: true, executionTarget: c.target } as ActionPayload;
      const res = executeActionPayload(payload);
      expect(res.ok).toBe(false);
      expect((res as { reason?: string }).reason).toBe('not_executable');
      expect(dispatched).toHaveLength(0); // nothing dispatched → no navigation → no creation modal
    });
  }
});

// ── TASK 1 #9 — follow-up with no valid context → safe no-context, no action ──
describe('R-REGRESSION: follow-up with no valid context is safe', () => {
  const engine = { getCustomers: () => [], getRepairs: () => [], getInventory: () => [] } as unknown as IntelligenceEngine;
  const freshCtx: FollowUpContext = { intentId: 'best_customer', query: '', responseText: '', ts: Date.now() };

  it('"contact him" with NO operational context emits no action', () => {
    const res = handleFollowUp(freshCtx, engine, 'en', null, 'contact him');
    expect(res.actions).toBeUndefined();
  });

  it('"open it" with NO operational context emits no action', () => {
    const res = handleFollowUp(freshCtx, engine, 'en', null, 'open it');
    expect(res.actions).toBeUndefined();
  });

  it('an expired follow-up context emits no action', () => {
    const expired: FollowUpContext = { ...freshCtx, ts: Date.now() - (31 * 60 * 1000) };
    const opCtx: OperationalContext = { type: 'customer', value: 'c1', timestamp: Date.now() };
    const res = handleFollowUp(expired, engine, 'en', opCtx, 'contact him');
    expect(res.actions).toBeUndefined();
  });
});

// ── TASK 1 #10 — proactive_operations dedupes equivalent buttons ──
describe('R-REGRESSION: proactive_operations never duplicates equivalent buttons', () => {
  function proactiveEngine(actions: ProactiveAction[]): IntelligenceEngine {
    return {
      getProactiveReport: () => ({ generatedAt: 0, summary: '', actions, topAction: actions[0] }),
      getRepairs: () => [{ id: 'r1', customerId: 'c1', customerName: 'Ana', customerPhone: '8050001111' }],
      getLayaways: () => [],
      getCustomers: () => [{ id: 'c1', name: 'Ana', phone: '8050001111' }],
      getInventory: () => [],
    } as unknown as IntelligenceEngine;
  }

  const mkAction = (id: string): ProactiveAction => ({
    id, category: 'repair_followup', priority: 'high',
    title: `Follow up repair ${id}`, reason: 'ready', recommendedAction: 'call',
    entityType: 'repair', entityId: 'r1', confidence: 1, createdAt: 0,
  });

  it('two actions on the SAME repair produce a single open_repair button', () => {
    // Both reference entityId 'r1' → naive button-building would emit two
    // identical open_repair buttons; the handler must dedupe to one.
    const engine = proactiveEngine([mkAction('a1'), mkAction('a2')]);
    const match = { id: 'proactive_operations', confidence: 1 } as IntentMatch;
    const res = handleIntent(match, engine, 'en');

    const keys = (res.actions ?? []).map(
      (a) => `${a.payload.executionTarget}:${(a.payload as any).entityId ?? (a.payload as any).customerId ?? a.id}`,
    );
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size); // no duplicate target:entity pairs
    expect(keys.filter((k) => k === 'open_repair:r1')).toHaveLength(1);
  });
});
