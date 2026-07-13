// ============================================================
// R-INTEL-V2-PHASE15 — learning-influenced contact-today ranking.
// Locks the safety contract: base score preserved, influence bounded,
// neutral fallback identical to the pre-Phase-15 formula, no side
// effects on stores or customer data.
// ============================================================

import { describe, it, expect } from 'vitest';
import { rankContactTodayCandidates } from './contactTodayRanker';
import { buildOutreachLearningModifiers } from '../outreach/outreachLearningInfluence';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { CustomerScore } from '../scoring/CustomerScorer';
import type { OutreachOutcomeEvent, OutreachOutcomeType } from '../outreach/outreachOutcomeTypes';

const DAY_MS = 86_400_000;
const NOW = Date.now();

// Two customers with IDENTICAL base inputs → identical base scores, so any
// ordering difference is attributable purely to the learning influence.
function makeEngine(): IntelligenceEngine {
  const history = (name: string) => ({
    customer: { name },
    grossRevenue: 50_000, // $500
    visitCount: 5,
    lastVisit: new Date(NOW - 20 * DAY_MS),
    linkedEntities: { repairCount: 1 },
  });
  const map: Record<string, unknown> = {
    alice: { ...history('Alice') },
    bruno: { ...history('Bruno') },
    carla: { ...history('Carla') },
  };
  (map.alice as any).customer.phone = '8050001111';
  (map.bruno as any).customer.phone = '8050002222';
  (map.carla as any).customer.phone = '8050003333';
  return {
    getCustomers: () => [
      { id: 'alice', communicationConsent: true },
      { id: 'bruno', communicationConsent: true },
      { id: 'carla', communicationConsent: true },
    ],
    getCustomerHistory: (id: string) => map[id],
  } as unknown as IntelligenceEngine;
}

const SCORES = [
  { customerId: 'alice' }, { customerId: 'bruno' }, { customerId: 'carla' },
] as unknown as CustomerScore[];

let seq = 0;
const ev = (customerId: string, outcome: OutreachOutcomeType): OutreachOutcomeEvent => ({
  id: `e-${++seq}`, customerId, outreachGroup: 'vip_inactive', outcome, timestamp: NOW - 5 * DAY_MS,
});

describe('rankContactTodayCandidates — learning influence contract', () => {
  it('no outcome history → ranking identical to the base formula (neutral fallback)', () => {
    const r = rankContactTodayCandidates(SCORES, makeEngine(), new Map());
    expect(r.top).toHaveLength(3);
    for (const c of r.top) {
      expect(c.rankScore).toBe(c.baseScore);      // base preserved, no influence
      expect(c.learning).toBeUndefined();
      // pre-Phase-15 formula: 50000/100 + 20*2 + 5*10 = 590
      expect(c.baseScore).toBe(590);
    }
  });

  it('insufficient history → output unchanged', () => {
    const mods = buildOutreachLearningModifiers([ev('alice', 'sale_completed')], NOW);
    const r = rankContactTodayCandidates(SCORES, makeEngine(), mods);
    for (const c of r.top) expect(c.rankScore).toBe(c.baseScore);
  });

  it('positive outcomes → bounded upward influence that can reorder equals', () => {
    const mods = buildOutreachLearningModifiers(
      [ev('bruno', 'payment_collected'), ev('bruno', 'visited_store')], NOW,
    );
    const r = rankContactTodayCandidates(SCORES, makeEngine(), mods);
    expect(r.top[0].customerId).toBe('bruno');            // moved up among equals
    expect(r.top[0].rankScore).toBeCloseTo(590 * 1.10, 6);
    expect(r.top[0].baseScore).toBe(590);                 // base preserved
    expect(r.top[0].learning?.reason).toBe('responds_to_outreach');
    expect(r.top[0].learning?.observationCount).toBe(2);
  });

  it('negative outcomes → bounded downward influence', () => {
    const mods = buildOutreachLearningModifiers(
      [ev('carla', 'ignored'), ev('carla', 'ignored')], NOW,
    );
    const r = rankContactTodayCandidates(SCORES, makeEngine(), mods);
    const carla = r.top.find((c) => c.customerId === 'carla')!;
    expect(carla.rankScore).toBeCloseTo(590 * 0.90, 6);
    expect(carla.learning?.reason).toBe('ignores_outreach');
    expect(r.top[r.top.length - 1].customerId).toBe('carla'); // moved down among equals
  });

  it('influence is capped — a flood of outcomes cannot dominate the base score', () => {
    const flood = Array.from({ length: 50 }, () => ev('alice', 'sale_completed'));
    const mods = buildOutreachLearningModifiers(flood, NOW);
    const r = rankContactTodayCandidates(SCORES, makeEngine(), mods);
    const alice = r.top.find((c) => c.customerId === 'alice')!;
    expect(alice.rankScore).toBeCloseTo(590 * 1.15, 6); // hard cap
  });

  it('deterministic: same inputs produce the same ranking', () => {
    const mods = buildOutreachLearningModifiers(
      [ev('bruno', 'sale_completed'), ev('bruno', 'repair_picked_up')], NOW,
    );
    const a = rankContactTodayCandidates(SCORES, makeEngine(), mods);
    const b = rankContactTodayCandidates(SCORES, makeEngine(), mods);
    expect(a.top.map((c) => c.customerId)).toEqual(b.top.map((c) => c.customerId));
  });

  it('has no side effects — engine data and modifiers are not mutated', () => {
    const mods = buildOutreachLearningModifiers(
      [ev('bruno', 'sale_completed'), ev('bruno', 'visited_store')], NOW,
    );
    const before = JSON.stringify([...mods.entries()]);
    rankContactTodayCandidates(SCORES, makeEngine(), mods);
    expect(JSON.stringify([...mods.entries()])).toBe(before);
  });
});
