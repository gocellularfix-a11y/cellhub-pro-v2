import { describe, it, expect } from 'vitest';
import type { OutcomeRecord, OutcomeStatus } from '../outcome/OutcomeRecord';
import { createOutcomeRegistry } from '../outcome/outcomeRegistry';
import {
  buildLearningSignalsFromOutcomeRegistry,
  deriveLearningConfidence,
} from './buildLearningSignals';

let n = 0;
function rec(status: OutcomeStatus): OutcomeRecord {
  n += 1;
  return {
    id: `outcome:q:prep:d${n}`,
    queueItemId: `q:prep:d${n}`,
    preparedActionId: `prep:d${n}`,
    sourceTopActionId: `d${n}`,
    outcomeStatus: status,
  };
}

/** Build a registry from N records of each status. */
function reg(counts: Partial<Record<OutcomeStatus, number>>) {
  const records: OutcomeRecord[] = [];
  (['COMPLETED', 'FAILED', 'CANCELLED', 'IGNORED'] as OutcomeStatus[]).forEach((s) => {
    for (let i = 0; i < (counts[s] ?? 0); i += 1) records.push(rec(s));
  });
  return createOutcomeRegistry(records);
}

const types = (signals: ReturnType<typeof buildLearningSignalsFromOutcomeRegistry>) =>
  signals.map((s) => s.signalType);

describe('buildLearningSignalsFromOutcomeRegistry', () => {
  it('empty registry returns []', () => {
    expect(buildLearningSignalsFromOutcomeRegistry(createOutcomeRegistry([]))).toEqual([]);
  });

  it('HIGH_COMPLETION when completionRate >= 0.80', () => {
    // 8/10 completed → 0.80
    const signals = buildLearningSignalsFromOutcomeRegistry(reg({ COMPLETED: 8, FAILED: 2 }));
    expect(types(signals)).toContain('HIGH_COMPLETION');
    expect(types(signals)).not.toContain('LOW_COMPLETION');
    const hc = signals.find((s) => s.signalType === 'HIGH_COMPLETION')!;
    expect(hc.value).toBeCloseTo(0.8);
    expect(hc.evidenceCount).toBe(10);
    expect(hc.subjectType).toBe('GLOBAL');
    expect(hc.subjectId).toBe('global');
    expect(hc.source).toBe('OUTCOME_REGISTRY');
    expect(hc.id).toBe('signal:global:HIGH_COMPLETION');
  });

  it('LOW_COMPLETION when completionRate < 0.50', () => {
    // 2/10 completed → 0.20
    const signals = buildLearningSignalsFromOutcomeRegistry(reg({ COMPLETED: 2, CANCELLED: 8 }));
    expect(types(signals)).toContain('LOW_COMPLETION');
    expect(types(signals)).not.toContain('HIGH_COMPLETION');
    const lc = signals.find((s) => s.signalType === 'LOW_COMPLETION')!;
    expect(lc.value).toBeCloseTo(0.2);
  });

  it('HIGH_FAILURE when failed / total >= 0.30', () => {
    // 3/10 failed → 0.30
    const signals = buildLearningSignalsFromOutcomeRegistry(reg({ COMPLETED: 7, FAILED: 3 }));
    expect(types(signals)).toContain('HIGH_FAILURE');
    const hf = signals.find((s) => s.signalType === 'HIGH_FAILURE')!;
    expect(hf.value).toBeCloseTo(0.3);
  });

  it('HIGH_IGNORE when ignored / total >= 0.30', () => {
    // 3/10 ignored → 0.30
    const signals = buildLearningSignalsFromOutcomeRegistry(reg({ COMPLETED: 7, IGNORED: 3 }));
    expect(types(signals)).toContain('HIGH_IGNORE');
    const hi = signals.find((s) => s.signalType === 'HIGH_IGNORE')!;
    expect(hi.value).toBeCloseTo(0.3);
  });

  it('emits multiple signals from the same registry', () => {
    // 2 completed, 4 failed, 4 ignored → rate 0.20 (LOW), failure 0.40 (HIGH), ignore 0.40 (HIGH)
    const signals = buildLearningSignalsFromOutcomeRegistry(
      reg({ COMPLETED: 2, FAILED: 4, IGNORED: 4 }),
    );
    expect(types(signals)).toEqual(['LOW_COMPLETION', 'HIGH_FAILURE', 'HIGH_IGNORE']);
  });

  it('emits no signals in the neutral band (0.50 <= rate < 0.80, no high failure/ignore)', () => {
    // 6 completed, 4 cancelled → rate 0.60, failure 0, ignore 0
    const signals = buildLearningSignalsFromOutcomeRegistry(reg({ COMPLETED: 6, CANCELLED: 4 }));
    expect(signals).toEqual([]);
  });

  describe('confidence tiers', () => {
    it('evidenceCount >= 20 → 1.0', () => {
      expect(deriveLearningConfidence(20)).toBe(1.0);
      expect(deriveLearningConfidence(100)).toBe(1.0);
    });
    it('evidenceCount >= 10 → 0.75', () => {
      expect(deriveLearningConfidence(10)).toBe(0.75);
      expect(deriveLearningConfidence(19)).toBe(0.75);
    });
    it('evidenceCount >= 5 → 0.5', () => {
      expect(deriveLearningConfidence(5)).toBe(0.5);
      expect(deriveLearningConfidence(9)).toBe(0.5);
    });
    it('otherwise → 0.25', () => {
      expect(deriveLearningConfidence(0)).toBe(0.25);
      expect(deriveLearningConfidence(4)).toBe(0.25);
    });
    it('confidence flows into the emitted signal', () => {
      const signals = buildLearningSignalsFromOutcomeRegistry(reg({ COMPLETED: 20 }));
      expect(signals[0].confidence).toBe(1.0);
      expect(signals[0].evidenceCount).toBe(20);
    });
  });

  it('is deterministic — same registry → identical output', () => {
    const r = reg({ COMPLETED: 2, FAILED: 4, IGNORED: 4 });
    expect(buildLearningSignalsFromOutcomeRegistry(r)).toEqual(
      buildLearningSignalsFromOutcomeRegistry(r),
    );
  });

  it('does not mutate the registry', () => {
    const r = reg({ COMPLETED: 2, FAILED: 4, IGNORED: 4 });
    const snapshot = JSON.stringify(r);
    buildLearningSignalsFromOutcomeRegistry(r);
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});
