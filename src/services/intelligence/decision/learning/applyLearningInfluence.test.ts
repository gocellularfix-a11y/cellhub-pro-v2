import { describe, it, expect } from 'vitest';
import type { IntelligenceDecision, DecisionUrgency } from '../IntelligenceDecision';
import type { ScoredDecision } from '../ranking/scoreDecision';
import { compareScoredDecisions } from '../ranking/scoreDecision';
import {
  applyLearningInfluence,
  buildEntityLearningModifiers,
  LEARNING_MODIFIER_CAP,
} from './applyLearningInfluence';

// Minimal ScoredDecision — applyLearningInfluence only reads decision.entityRef.id,
// decision.urgency, and priority (plus decision.id for tie-break ordering).
function sd(
  id: string,
  priority: number,
  opts: { urgency?: DecisionUrgency; entityId?: string } = {},
): ScoredDecision {
  const decision = {
    id,
    urgency: opts.urgency ?? 'high',
    entityRef: opts.entityId ? { type: 'customer', id: opts.entityId } : undefined,
  } as unknown as IntelligenceDecision;
  return { decision, priority, valueScore: 0, urgencyScore: 0, confidence: 0, cooldownPenalty: 0 };
}

describe('buildEntityLearningModifiers (R-INTEL-LEARNING-WIRE)', () => {
  it('maps a +10 fingerprint score to the +cap modifier', () => {
    const m = buildEntityLearningModifiers(new Map([['review|customer|cust-1|unpaid', 10]]));
    expect(m.get('cust-1')).toBeCloseTo(LEARNING_MODIFIER_CAP, 10);
  });

  it('maps a -10 fingerprint score to the -cap modifier', () => {
    const m = buildEntityLearningModifiers(new Map([['review|customer|cust-2|noise', -10]]));
    expect(m.get('cust-2')).toBeCloseTo(-LEARNING_MODIFIER_CAP, 10);
  });

  it('aggregates multiple fingerprints per entity and clamps beyond the span', () => {
    const m = buildEntityLearningModifiers(
      new Map([
        ['review|customer|cust-3|a', -10],
        ['general|customer|cust-3|b', -10], // sum -20 → clamps to -10 → -cap
      ]),
    );
    expect(m.get('cust-3')).toBeCloseTo(-LEARNING_MODIFIER_CAP, 10);
  });

  it('ignores fingerprints with no entityId segment', () => {
    const m = buildEntityLearningModifiers(new Map([['review|customer||no-entity', 10]]));
    expect(m.size).toBe(0);
  });

  it('does not throw on malformed input and returns empty', () => {
    expect(() => buildEntityLearningModifiers(null)).not.toThrow();
    expect(buildEntityLearningModifiers(null).size).toBe(0);
    expect(buildEntityLearningModifiers(undefined).size).toBe(0);
    // garbage scores skipped
    const m = buildEntityLearningModifiers(new Map([['a|b|e1|t', Number.NaN]]));
    expect(m.size).toBe(0);
  });
});

describe('applyLearningInfluence (R-INTEL-LEARNING-WIRE)', () => {
  it('no learning data → ranking/score unchanged (same references)', () => {
    const scored = [sd('d1', 80, { entityId: 'e1' }), sd('d2', 60, { entityId: 'e2' })];
    expect(applyLearningInfluence(scored, new Map())).toBe(scored);
    expect(applyLearningInfluence(scored, null)).toBe(scored);
    expect(applyLearningInfluence(scored, undefined)).toBe(scored);
  });

  it('negative feedback lowers score within the cap', () => {
    const [out] = applyLearningInfluence([sd('d1', 80, { entityId: 'e1' })], new Map([['e1', -LEARNING_MODIFIER_CAP]]));
    // 80 * (1 - 0.10) = 72
    expect(out.priority).toBe(72);
    expect(out.basePriority).toBe(80);
    expect(out.learningModifier).toBeCloseTo(-LEARNING_MODIFIER_CAP, 10);
    // Never drops more than the cap fraction.
    expect(out.priority).toBeGreaterThanOrEqual(Math.round(80 * (1 - LEARNING_MODIFIER_CAP)));
  });

  it('positive outcome boosts score within the cap', () => {
    const [out] = applyLearningInfluence([sd('d1', 80, { entityId: 'e1' })], new Map([['e1', LEARNING_MODIFIER_CAP]]));
    // 80 * 1.10 = 88
    expect(out.priority).toBe(88);
    expect(out.priority).toBeLessThanOrEqual(Math.round(80 * (1 + LEARNING_MODIFIER_CAP)));
  });

  it('caps an out-of-range modifier (no excessive penalty/boost)', () => {
    const [pen] = applyLearningInfluence([sd('d1', 80, { entityId: 'e1' })], new Map([['e1', -5]]));
    expect(pen.priority).toBe(72); // clamped to -0.10, not -500%
    const [boost] = applyLearningInfluence([sd('d2', 80, { entityId: 'e2' })], new Map([['e2', 5]]));
    expect(boost.priority).toBe(88); // clamped to +0.10
  });

  it('critical item still ranks despite negative learning (never demoted)', () => {
    const critical = sd('crit', 80, { urgency: 'critical', entityId: 'e1' });
    const rival = sd('rival', 78, { urgency: 'high', entityId: 'e2' });
    const out = applyLearningInfluence([critical, rival], new Map([['e1', -LEARNING_MODIFIER_CAP]]));
    const c = out.find((s) => s.decision.id === 'crit')!;
    expect(c.priority).toBe(80); // unchanged — negative modifier ignored for critical
    expect(c.learningModifier).toBeUndefined();
    out.sort(compareScoredDecisions);
    expect(out[0].decision.id).toBe('crit'); // critical still ranks first
  });

  it('positive learning still applies to critical (helps it surface)', () => {
    const [out] = applyLearningInfluence(
      [sd('crit', 80, { urgency: 'critical', entityId: 'e1' })],
      new Map([['e1', LEARNING_MODIFIER_CAP]]),
    );
    expect(out.priority).toBe(88);
  });

  it('does not throw on malformed scored input and returns it unchanged', () => {
    const garbage = [{ decision: null, priority: 50 }] as unknown as ScoredDecision[];
    let out!: ScoredDecision[];
    expect(() => { out = applyLearningInfluence(garbage, new Map([['e1', -0.1]])); }).not.toThrow();
    expect(out[0].priority).toBe(50);
  });

  it('reorders deterministically: boost lifts above an unboosted rival', () => {
    const a = sd('a', 70, { entityId: 'ea' });
    const b = sd('b', 72, { entityId: 'eb' });
    // Boost A by +10% → 77, above B's 72.
    const out = applyLearningInfluence([a, b], new Map([['ea', LEARNING_MODIFIER_CAP]]));
    out.sort(compareScoredDecisions);
    expect(out.map((s) => s.decision.id)).toEqual(['a', 'b']);
  });

  it('ties broken deterministically by decision id (stable)', () => {
    // Equal base, equal modifier → equal adjusted priority → id tiebreak.
    const out = applyLearningInfluence(
      [sd('zeta', 60, { entityId: 'e1' }), sd('alpha', 60, { entityId: 'e2' })],
      new Map([['e1', LEARNING_MODIFIER_CAP], ['e2', LEARNING_MODIFIER_CAP]]),
    );
    out.sort(compareScoredDecisions);
    expect(out.map((s) => s.decision.id)).toEqual(['alpha', 'zeta']);
  });
});
