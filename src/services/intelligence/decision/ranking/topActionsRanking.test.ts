import { describe, it, expect } from 'vitest';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import type { IntelligenceDecision, DecisionUrgency, DecisionDomain, DecisionSource } from '../IntelligenceDecision';
import { normalizeAndRank, rankToTopActions, dedupeKey, MAX_TOP_ACTIONS } from './topActionsRanking';

// ── Fixture ───────────────────────────────────────────────
function action(over: Record<string, unknown>): ChatActionUI {
  return { id: 'a', label: 'l', payload: {}, ...over } as ChatActionUI;
}

let n = 0;
function decision(over: Partial<IntelligenceDecision> = {}): IntelligenceDecision {
  n += 1;
  return {
    id: over.id ?? `d${n}`,
    domain: 'cash',
    observation: 'obs',
    reasoning: 'why',
    decision: 'do it',
    confidence: 50,
    confidenceBasis: 'from-score',
    score: 50,
    impactCents: 10_000,
    urgency: 'medium' as DecisionUrgency,
    actionPlan: { steps: ['do it'], actions: [] },
    financialSensitive: false,
    safeToRunOnSecondary: true,
    source: { kind: 'loss', signal: {} as never } as DecisionSource,
    ...over,
  };
}

describe('normalizeAndRank — mixed signals + ranking', () => {
  it('ranks a mix of source kinds by priority desc', () => {
    const decisions = [
      decision({ id: 'lo', entityRef: { type: 'customer', id: 'e-lo' }, source: { kind: 'attention', signal: {} as never }, urgency: 'low', impactCents: 100, confidence: 10 }),
      decision({ id: 'hi', entityRef: { type: 'product', id: 'e-hi' }, source: { kind: 'loss', signal: {} as never }, urgency: 'critical', impactCents: 90_000, confidence: 100 }),
      decision({ id: 'mid', entityRef: { type: 'repair', id: 'e-mid' }, source: { kind: 'proactive', signal: {} as never }, urgency: 'medium', impactCents: 8_000, confidence: 50 }),
    ];
    expect(normalizeAndRank(decisions).map((s) => s.decision.id)).toEqual(['hi', 'mid', 'lo']);
  });

  it('is deterministic — same input → same ranking', () => {
    const ds = [decision({ id: 'a', urgency: 'high' }), decision({ id: 'b', urgency: 'low' })];
    expect(normalizeAndRank(ds).map((s) => s.decision.id)).toEqual(normalizeAndRank(ds).map((s) => s.decision.id));
  });

  it('cooldown injection demotes a recently-actioned decision', () => {
    const a = decision({ id: 'a', urgency: 'critical', impactCents: 90_000, confidence: 100, entityRef: { type: 'customer', id: 'cust-a' } });
    const b = decision({ id: 'b', urgency: 'high', impactCents: 20_000, confidence: 70, entityRef: { type: 'customer', id: 'cust-b' } });
    const fresh = normalizeAndRank([a, b]).map((s) => s.decision.id);
    expect(fresh).toEqual(['a', 'b']);
    // Demote 'a' via cooldown → 'b' should overtake.
    const cooled = normalizeAndRank([a, b], { recentlyActioned: (d) => d.entityRef?.id === 'cust-a' }).map((s) => s.decision.id);
    expect(cooled).toEqual(['b', 'a']);
  });
});

describe('deduplication', () => {
  it('collapses repeats of the same entityRef.id (keeps highest priority)', () => {
    const weak = decision({ id: 'weak', urgency: 'low', impactCents: 100, confidence: 10, entityRef: { type: 'customer', id: 'cust-1' } });
    const strong = decision({ id: 'strong', urgency: 'critical', impactCents: 90_000, confidence: 100, entityRef: { type: 'customer', id: 'cust-1' } });
    const ranked = normalizeAndRank([weak, strong]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].decision.id).toBe('strong');
  });

  it('collapses same (domain + recommended action) when no entityRef', () => {
    const a = decision({ id: 'a', domain: 'ops', decision: 'promote', entityRef: undefined, urgency: 'high' });
    const b = decision({ id: 'b', domain: 'ops', decision: 'promote', entityRef: undefined, urgency: 'low' });
    const ranked = normalizeAndRank([a, b]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].decision.id).toBe('a'); // higher urgency survives
  });

  it('keeps distinct entities separate', () => {
    const a = decision({ id: 'a', entityRef: { type: 'customer', id: 'c1' } });
    const b = decision({ id: 'b', entityRef: { type: 'customer', id: 'c2' } });
    expect(normalizeAndRank([a, b])).toHaveLength(2);
  });

  it('dedupeKey prefers entity id over domain+action', () => {
    expect(dedupeKey(decision({ entityRef: { type: 'repair', id: 'r9' } }))).toBe('id:r9');
    expect(dedupeKey(decision({ entityRef: undefined, domain: 'inventory', decision: 'reorder' }))).toBe('da:inventory:reorder');
  });
});

describe('rankToTopActions — TopAction output', () => {
  it('returns at most 3 (top-3 limit)', () => {
    const ds = Array.from({ length: 5 }, (_, i) =>
      decision({ id: `d${i}`, entityRef: { type: 'customer', id: `c${i}` }, urgency: 'high', confidence: 90 - i }),
    );
    expect(rankToTopActions(ds)).toHaveLength(MAX_TOP_ACTIONS);
  });

  it('maps fields and enriches with approval requirement (soft-queue for whatsapp)', () => {
    const d = decision({
      id: 'wa', reasoning: 'Reconnect lapsed VIP', observation: 'no visit 40d', domain: 'customer',
      confidence: 72, impactCents: 15_000,
      actionPlan: { steps: ['msg'], actions: [action({ actionType: 'whatsapp' })] },
    });
    const [top] = rankToTopActions([d]);
    expect(top).toEqual({
      decisionId: 'wa',
      title: 'Reconnect lapsed VIP',
      reason: 'no visit 40d',
      domain: 'customer',
      confidence: 72,
      impactCents: 15_000,
      approvalRequired: true,
      approvalKind: 'soft-queue',
    });
  });

  it('hard-gate (discount) enriches approvalKind=hard-gate', () => {
    const d = decision({ id: 'deal', actionPlan: { steps: ['x'], actions: [action({ actionType: 'discount' })] } });
    const [top] = rankToTopActions([d]);
    expect(top.approvalKind).toBe('hard-gate');
    expect(top.approvalRequired).toBe(true);
  });

  it('navigation/none → no approval', () => {
    const d = decision({ id: 'open', actionPlan: { steps: ['x'], actions: [action({})] } });
    expect(rankToTopActions([d])[0].approvalRequired).toBe(false);
  });

  it('empty source set → empty result', () => {
    expect(rankToTopActions([])).toEqual([]);
    expect(normalizeAndRank([])).toEqual([]);
  });
});

describe('stability', () => {
  it('re-ranking a ranked list is a no-op', () => {
    const ds = [
      decision({ id: 'c', urgency: 'low', entityRef: { type: 'x', id: 'c' } }),
      decision({ id: 'a', urgency: 'critical', entityRef: { type: 'x', id: 'a' } }),
      decision({ id: 'b', urgency: 'high', entityRef: { type: 'x', id: 'b' } }),
    ];
    const once = normalizeAndRank(ds).map((s) => s.decision.id);
    const twice = normalizeAndRank(normalizeAndRank(ds).map((s) => s.decision)).map((s) => s.decision.id);
    expect(twice).toEqual(once);
    expect(once).toEqual(['a', 'b', 'c']);
  });
});
