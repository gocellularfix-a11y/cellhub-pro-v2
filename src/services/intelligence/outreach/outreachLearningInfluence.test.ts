// ============================================================
// R-INTEL-V2-PHASE15 — bounded outreach outcome learning.
// Pure-builder tests: events built inline, `now` injected — deterministic.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildOutreachLearningModifiers,
  OUTREACH_LEARNING_MIN_OBSERVATIONS,
  OUTREACH_LEARNING_MAX_MULTIPLIER,
  OUTREACH_LEARNING_MIN_MULTIPLIER,
  OUTREACH_LEARNING_LOOKBACK_DAYS,
} from './outreachLearningInfluence';
import type { OutreachOutcomeEvent, OutreachOutcomeType } from './outreachOutcomeTypes';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 13, 12, 0, 0);

let seq = 0;
function ev(customerId: string, outcome: OutreachOutcomeType, ageDays = 5, id?: string): OutreachOutcomeEvent {
  return {
    id: id ?? `ev-${++seq}`,
    customerId,
    outreachGroup: 'vip_inactive',
    outcome,
    timestamp: NOW - ageDays * DAY_MS,
  };
}

describe('buildOutreachLearningModifiers — evidence thresholds', () => {
  it('no history → empty map (neutral)', () => {
    expect(buildOutreachLearningModifiers([], NOW).size).toBe(0);
  });

  it('insufficient history (below minimum observations) → no modifier', () => {
    const m = buildOutreachLearningModifiers([ev('c1', 'payment_collected')], NOW);
    expect(OUTREACH_LEARNING_MIN_OBSERVATIONS).toBeGreaterThan(1);
    expect(m.has('c1')).toBe(false);
  });

  it('conflicting evidence (net zero) → no modifier', () => {
    const m = buildOutreachLearningModifiers(
      [ev('c1', 'sale_completed'), ev('c1', 'ignored')], NOW,
    );
    expect(m.has('c1')).toBe(false);
  });

  it("'sent' and 'replied' are neutral — they never create influence alone", () => {
    const m = buildOutreachLearningModifiers(
      [ev('c1', 'sent'), ev('c1', 'replied'), ev('c1', 'sent')], NOW,
    );
    expect(m.size).toBe(0);
  });
});

describe('buildOutreachLearningModifiers — bounded influence', () => {
  it('positive outcomes → bounded upward multiplier with explanation', () => {
    const m = buildOutreachLearningModifiers(
      [ev('c1', 'payment_collected'), ev('c1', 'visited_store')], NOW,
    );
    const mod = m.get('c1')!;
    expect(mod.multiplier).toBeCloseTo(1.10, 10); // 2 net conversions × 5%
    expect(mod.reason).toBe('responds_to_outreach');
    expect(mod.convertedCount).toBe(2);
    expect(mod.observationCount).toBe(2);
  });

  it('negative outcomes → bounded downward multiplier with explanation', () => {
    const m = buildOutreachLearningModifiers(
      [ev('c1', 'ignored'), ev('c1', 'ignored')], NOW,
    );
    const mod = m.get('c1')!;
    expect(mod.multiplier).toBeCloseTo(0.90, 10);
    expect(mod.reason).toBe('ignores_outreach');
    expect(mod.ignoredCount).toBe(2);
  });

  it('cap enforced: influence never exceeds ±15% no matter the evidence volume', () => {
    const many = Array.from({ length: 10 }, () => ev('up', 'sale_completed'))
      .concat(Array.from({ length: 10 }, () => ev('down', 'ignored')));
    const m = buildOutreachLearningModifiers(many, NOW);
    expect(m.get('up')!.multiplier).toBe(OUTREACH_LEARNING_MAX_MULTIPLIER);
    expect(m.get('down')!.multiplier).toBe(OUTREACH_LEARNING_MIN_MULTIPLIER);
  });
});

describe('buildOutreachLearningModifiers — hygiene', () => {
  it('stale outcomes (outside the lookback) are excluded', () => {
    const m = buildOutreachLearningModifiers(
      [
        ev('c1', 'payment_collected', OUTREACH_LEARNING_LOOKBACK_DAYS + 1),
        ev('c1', 'sale_completed', OUTREACH_LEARNING_LOOKBACK_DAYS + 2),
      ],
      NOW,
    );
    expect(m.has('c1')).toBe(false);
  });

  it('duplicate event ids are counted once', () => {
    const dup = ev('c1', 'payment_collected', 5, 'same-id');
    const m = buildOutreachLearningModifiers([dup, { ...dup }], NOW);
    // one unique signal event < minimum → neutral
    expect(m.has('c1')).toBe(false);
  });

  it('is deterministic for the same inputs', () => {
    const events = [ev('a', 'sale_completed', 3, 'e1'), ev('a', 'visited_store', 4, 'e2'), ev('b', 'ignored', 2, 'e3'), ev('b', 'ignored', 6, 'e4')];
    const one = buildOutreachLearningModifiers(events, NOW);
    const two = buildOutreachLearningModifiers(events, NOW);
    expect([...one.entries()]).toEqual([...two.entries()]);
  });
});
