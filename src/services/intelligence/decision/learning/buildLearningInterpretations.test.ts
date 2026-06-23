import { describe, it, expect } from 'vitest';
import type { LearningSignal, LearningSignalType } from './LearningSignal';
import {
  buildLearningInterpretations,
  deriveInterpretationSeverity,
} from './buildLearningInterpretations';

function sig(signalType: LearningSignalType, confidence: number, value = 0.5): LearningSignal {
  return {
    id: `signal:global:${signalType}`,
    source: 'OUTCOME_REGISTRY',
    signalType,
    subjectType: 'GLOBAL',
    subjectId: 'global',
    value,
    confidence,
    evidenceCount: 10,
  };
}

describe('buildLearningInterpretations', () => {
  it('empty input returns []', () => {
    expect(buildLearningInterpretations([])).toEqual([]);
  });

  describe('mapping rules (signal → interpretation)', () => {
    const cases: Array<[LearningSignalType, string, string]> = [
      ['HIGH_COMPLETION', 'STRONG_COMPLETION_PATTERN', 'Historical outcomes show consistently strong completion rates.'],
      ['LOW_COMPLETION', 'WEAK_COMPLETION_PATTERN', 'Historical outcomes show weak completion rates.'],
      ['HIGH_FAILURE', 'ELEVATED_FAILURE_PATTERN', 'Historical outcomes indicate elevated failure rates.'],
      ['HIGH_IGNORE', 'ELEVATED_IGNORE_PATTERN', 'Historical outcomes indicate elevated ignore rates.'],
    ];

    it.each(cases)('%s → %s with deterministic summary', (signalType, interpType, summary) => {
      const [out] = buildLearningInterpretations([sig(signalType, 0.75)]);
      expect(out.interpretationType).toBe(interpType);
      expect(out.summary).toBe(summary);
      expect(out.id).toBe(`interp:${interpType}`);
      expect(out.sourceSignalIds).toEqual([`signal:global:${signalType}`]);
    });
  });

  describe('severity tiers (confidence only)', () => {
    it('confidence >= 1.0 → HIGH', () => {
      expect(deriveInterpretationSeverity(1.0)).toBe('HIGH');
      expect(buildLearningInterpretations([sig('HIGH_FAILURE', 1.0)])[0].severity).toBe('HIGH');
    });
    it('confidence >= 0.75 → MEDIUM', () => {
      expect(deriveInterpretationSeverity(0.75)).toBe('MEDIUM');
      expect(deriveInterpretationSeverity(0.99)).toBe('MEDIUM');
    });
    it('otherwise → LOW', () => {
      expect(deriveInterpretationSeverity(0.5)).toBe('LOW');
      expect(deriveInterpretationSeverity(0.25)).toBe('LOW');
      expect(deriveInterpretationSeverity(0)).toBe('LOW');
    });
    it('confidence carries through unchanged from the signal', () => {
      const [out] = buildLearningInterpretations([sig('HIGH_COMPLETION', 0.5)]);
      expect(out.confidence).toBe(0.5);
      expect(out.severity).toBe('LOW');
    });
  });

  it('emits one interpretation per signal, in input order (no merging)', () => {
    const signals = [
      sig('LOW_COMPLETION', 0.75),
      sig('HIGH_FAILURE', 1.0),
      sig('HIGH_IGNORE', 0.25),
    ];
    const out = buildLearningInterpretations(signals);
    expect(out.map((i) => i.interpretationType)).toEqual([
      'WEAK_COMPLETION_PATTERN',
      'ELEVATED_FAILURE_PATTERN',
      'ELEVATED_IGNORE_PATTERN',
    ]);
    expect(out.map((i) => i.severity)).toEqual(['MEDIUM', 'HIGH', 'LOW']);
  });

  it('is deterministic — same signals → identical output', () => {
    const signals = [sig('HIGH_COMPLETION', 1.0), sig('HIGH_FAILURE', 0.75)];
    expect(buildLearningInterpretations(signals)).toEqual(
      buildLearningInterpretations(signals),
    );
  });

  it('does not mutate the input signals', () => {
    const signals = [sig('HIGH_COMPLETION', 1.0), sig('HIGH_IGNORE', 0.75)];
    const snapshot = JSON.stringify(signals);
    buildLearningInterpretations(signals);
    expect(JSON.stringify(signals)).toBe(snapshot);
  });
});
