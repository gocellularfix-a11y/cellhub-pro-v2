import { describe, it, expect } from 'vitest';
import type { IntelligenceDecision, DecisionUrgency, DecisionDomain } from '../IntelligenceDecision';
import {
  scoreDecision,
  valueScore,
  urgencyScore,
  cooldownPenalty,
  compareScoredDecisions,
  COOLDOWN_PENALTY,
} from './scoreDecision';

// ── Fixture ───────────────────────────────────────────────
function decision(over: Partial<IntelligenceDecision> = {}): IntelligenceDecision {
  return {
    id: 'd1',
    domain: 'cash',
    observation: 'o',
    reasoning: 'r',
    decision: 'do it',
    confidence: 50,
    confidenceBasis: 'from-score',
    score: 50,
    impactCents: 10000,
    urgency: 'medium',
    actionPlan: { steps: ['do it'], actions: [] },
    financialSensitive: false,
    safeToRunOnSecondary: true,
    source: { kind: 'loss', signal: {} as never },
    ...over,
  };
}

describe('valueScore — bands', () => {
  it('maps dollar bands deterministically', () => {
    expect(valueScore(60_000)).toBe(100); // ≥ $500
    expect(valueScore(50_000)).toBe(100);
    expect(valueScore(25_000)).toBe(70);  // ≥ $200
    expect(valueScore(20_000)).toBe(70);
    expect(valueScore(8_000)).toBe(40);   // ≥ $50
    expect(valueScore(5_000)).toBe(40);
    expect(valueScore(100)).toBe(20);     // > $0
    expect(valueScore(0)).toBe(0);
    expect(valueScore(undefined)).toBe(0);
    expect(valueScore(-500)).toBe(0);
  });
});

describe('urgencyScore — ordering', () => {
  it('critical > high > medium > low', () => {
    const order: DecisionUrgency[] = ['critical', 'high', 'medium', 'low'];
    const scores = order.map(urgencyScore);
    expect(scores).toEqual([100, 70, 40, 15]);
    // strictly descending
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });
});

describe('cooldownPenalty', () => {
  it('applies a flat penalty only when recently actioned', () => {
    expect(cooldownPenalty(true)).toBe(COOLDOWN_PENALTY);
    expect(cooldownPenalty(false)).toBe(0);
    expect(cooldownPenalty(undefined)).toBe(0);
  });
});

describe('scoreDecision — composition', () => {
  it('combines value + urgency + confidence', () => {
    // value 100 (×0.45=45) + urgency critical 100 (×0.30=30) + confidence 100 (×0.25=25) = 100
    const s = scoreDecision(decision({ impactCents: 60_000, urgency: 'critical', confidence: 100 }));
    expect(s.priority).toBe(100);
    expect(s.valueScore).toBe(100);
    expect(s.urgencyScore).toBe(100);
  });

  it('higher confidence → higher priority (all else equal)', () => {
    const lo = scoreDecision(decision({ confidence: 20 }));
    const hi = scoreDecision(decision({ confidence: 90 }));
    expect(hi.priority).toBeGreaterThan(lo.priority);
  });

  it('cooldown lowers priority', () => {
    const fresh = scoreDecision(decision({ impactCents: 60_000, urgency: 'critical', confidence: 100 }));
    const cooled = scoreDecision(
      decision({ impactCents: 60_000, urgency: 'critical', confidence: 100 }),
      { recentlyActioned: true },
    );
    expect(cooled.priority).toBe(fresh.priority - COOLDOWN_PENALTY);
    expect(cooled.cooldownPenalty).toBe(COOLDOWN_PENALTY);
  });

  it('clamps priority to ≥ 0 when cooldown exceeds the raw score', () => {
    const s = scoreDecision(decision({ impactCents: undefined, urgency: 'low', confidence: 0 }), {
      recentlyActioned: true,
    });
    expect(s.priority).toBe(0);
  });

  it('is deterministic', () => {
    const d = decision({ impactCents: 25_000, urgency: 'high', confidence: 60 });
    expect(scoreDecision(d, { recentlyActioned: true })).toEqual(scoreDecision(d, { recentlyActioned: true }));
  });
});

describe('compareScoredDecisions — total-order tie-break', () => {
  // Hand-build ScoredDecision so each tie-break level can be isolated with an
  // equal priority above it.
  function scored(over: {
    id?: string; domain?: DecisionDomain; impactCents?: number;
    priority?: number; urgencyScore?: number; confidence?: number;
  }): ReturnType<typeof scoreDecision> {
    return {
      decision: decision({ id: over.id ?? 'd', domain: over.domain ?? 'cash', impactCents: over.impactCents }),
      priority: over.priority ?? 50,
      valueScore: 0,
      urgencyScore: over.urgencyScore ?? 40,
      confidence: over.confidence ?? 50,
      cooldownPenalty: 0,
    };
  }

  it('1. priority desc wins', () => {
    const lo = scored({ id: 'a', priority: 10 });
    const hi = scored({ id: 'b', priority: 90 });
    expect([lo, hi].sort(compareScoredDecisions).map((s) => s.decision.id)).toEqual(['b', 'a']);
  });

  it('2. priority tie → urgency desc', () => {
    const lo = scored({ id: 'a', priority: 50, urgencyScore: 40 });
    const hi = scored({ id: 'b', priority: 50, urgencyScore: 100 });
    expect([lo, hi].sort(compareScoredDecisions).map((s) => s.decision.id)).toEqual(['b', 'a']);
  });

  it('3. priority+urgency tie → impact desc', () => {
    const lo = scored({ id: 'a', priority: 50, urgencyScore: 40, impactCents: 1_000 });
    const hi = scored({ id: 'b', priority: 50, urgencyScore: 40, impactCents: 90_000 });
    expect([lo, hi].sort(compareScoredDecisions).map((s) => s.decision.id)).toEqual(['b', 'a']);
  });

  it('4. +impact tie → confidence desc', () => {
    const lo = scored({ id: 'a', priority: 50, urgencyScore: 40, impactCents: 1_000, confidence: 30 });
    const hi = scored({ id: 'b', priority: 50, urgencyScore: 40, impactCents: 1_000, confidence: 95 });
    expect([lo, hi].sort(compareScoredDecisions).map((s) => s.decision.id)).toEqual(['b', 'a']);
  });

  it('5. +confidence tie → domain fixed-order', () => {
    const repair = scored({ id: 'a', domain: 'repair', priority: 50, urgencyScore: 40, impactCents: 1_000, confidence: 50 });
    const cash = scored({ id: 'b', domain: 'cash', priority: 50, urgencyScore: 40, impactCents: 1_000, confidence: 50 });
    // cash (order 0) before repair (order 1) despite later id
    expect([repair, cash].sort(compareScoredDecisions).map((s) => s.decision.domain)).toEqual(['cash', 'repair']);
  });

  it('6. full tie → decision.id lexicographic', () => {
    const b = scored({ id: 'b', domain: 'cash', priority: 50, urgencyScore: 40, impactCents: 1_000, confidence: 50 });
    const a = scored({ id: 'a', domain: 'cash', priority: 50, urgencyScore: 40, impactCents: 1_000, confidence: 50 });
    expect([b, a].sort(compareScoredDecisions).map((s) => s.decision.id)).toEqual(['a', 'b']);
  });

  it('is a stable total order — re-sorting a sorted list is a no-op', () => {
    const items = [
      scored({ id: 'c', priority: 30 }),
      scored({ id: 'a', priority: 90 }),
      scored({ id: 'b', priority: 60 }),
      scored({ id: 'd', priority: 60 }), // priority tie with b → id breaks
    ];
    const once = items.slice().sort(compareScoredDecisions);
    const twice = once.slice().sort(compareScoredDecisions);
    expect(twice.map((s) => s.decision.id)).toEqual(once.map((s) => s.decision.id));
    expect(once.map((s) => s.decision.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});
