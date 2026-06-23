import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  LearningInterpretation,
  LearningInterpretationType,
  LearningInterpretationSeverity,
} from './LearningInterpretation';
import { buildLearningInfluences } from './buildLearningInfluences';
import { MAX_ABSOLUTE_LEARNING_MODIFIER } from './LearningInfluence';

function interp(
  interpretationType: LearningInterpretationType,
  severity: LearningInterpretationSeverity,
  confidence = 0.75,
): LearningInterpretation {
  return {
    id: `interp:${interpretationType}`,
    interpretationType,
    severity,
    confidence,
    sourceSignalIds: [`signal:global:${interpretationType}`],
    summary: 'irrelevant for influence',
  };
}

describe('buildLearningInfluences', () => {
  it('empty input → []', () => {
    expect(buildLearningInfluences([])).toEqual([]);
  });

  describe('interpretation type → influence type mapping', () => {
    const cases: Array<[LearningInterpretationType, string]> = [
      ['STRONG_COMPLETION_PATTERN', 'COMPLETION_BOOST'],
      ['WEAK_COMPLETION_PATTERN', 'COMPLETION_DROP'],
      ['ELEVATED_FAILURE_PATTERN', 'FAILURE_DAMPEN'],
      ['ELEVATED_IGNORE_PATTERN', 'IGNORE_DAMPEN'],
    ];
    it.each(cases)('%s → %s', (interpType, influenceType) => {
      const [out] = buildLearningInfluences([interp(interpType, 'MEDIUM')]);
      expect(out.influenceType).toBe(influenceType);
      expect(out.id).toBe(`influence:global:${influenceType}`);
      expect(out.subjectType).toBe('GLOBAL');
      expect(out.subjectId).toBe('global');
    });
  });

  describe('severity → magnitude', () => {
    it('HIGH → 0.10', () => {
      expect(Math.abs(buildLearningInfluences([interp('ELEVATED_FAILURE_PATTERN', 'HIGH')])[0].modifier)).toBeCloseTo(0.1);
    });
    it('MEDIUM → 0.05', () => {
      expect(Math.abs(buildLearningInfluences([interp('ELEVATED_FAILURE_PATTERN', 'MEDIUM')])[0].modifier)).toBeCloseTo(0.05);
    });
    it('LOW → 0.02', () => {
      expect(Math.abs(buildLearningInfluences([interp('ELEVATED_FAILURE_PATTERN', 'LOW')])[0].modifier)).toBeCloseTo(0.02);
    });
  });

  describe('modifier signs', () => {
    it('COMPLETION_BOOST is positive', () => {
      expect(buildLearningInfluences([interp('STRONG_COMPLETION_PATTERN', 'HIGH')])[0].modifier).toBeGreaterThan(0);
    });
    it('COMPLETION_DROP / FAILURE_DAMPEN / IGNORE_DAMPEN are negative', () => {
      expect(buildLearningInfluences([interp('WEAK_COMPLETION_PATTERN', 'HIGH')])[0].modifier).toBeLessThan(0);
      expect(buildLearningInfluences([interp('ELEVATED_FAILURE_PATTERN', 'HIGH')])[0].modifier).toBeLessThan(0);
      expect(buildLearningInfluences([interp('ELEVATED_IGNORE_PATTERN', 'HIGH')])[0].modifier).toBeLessThan(0);
    });
  });

  it('modifiers are always within [-0.10, 0.10]', () => {
    const all: LearningInterpretation[] = [
      interp('STRONG_COMPLETION_PATTERN', 'HIGH'),
      interp('WEAK_COMPLETION_PATTERN', 'HIGH'),
      interp('ELEVATED_FAILURE_PATTERN', 'MEDIUM'),
      interp('ELEVATED_IGNORE_PATTERN', 'LOW'),
    ];
    for (const inf of buildLearningInfluences(all)) {
      expect(inf.modifier).toBeGreaterThanOrEqual(-MAX_ABSOLUTE_LEARNING_MODIFIER);
      expect(inf.modifier).toBeLessThanOrEqual(MAX_ABSOLUTE_LEARNING_MODIFIER);
    }
  });

  it('advisoryOnly is always true', () => {
    const out = buildLearningInfluences([
      interp('STRONG_COMPLETION_PATTERN', 'HIGH'),
      interp('ELEVATED_IGNORE_PATTERN', 'LOW'),
    ]);
    expect(out.every((i) => i.advisoryOnly === true)).toBe(true);
  });

  it('emits one influence per interpretation, preserving input order (no merge)', () => {
    const input = [
      interp('ELEVATED_IGNORE_PATTERN', 'LOW'),
      interp('STRONG_COMPLETION_PATTERN', 'HIGH'),
      interp('WEAK_COMPLETION_PATTERN', 'MEDIUM'),
    ];
    const out = buildLearningInfluences(input);
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.influenceType)).toEqual([
      'IGNORE_DAMPEN',
      'COMPLETION_BOOST',
      'COMPLETION_DROP',
    ]);
  });

  it('sourceInterpretationIds thread correctly', () => {
    const i = interp('STRONG_COMPLETION_PATTERN', 'HIGH');
    expect(buildLearningInfluences([i])[0].sourceInterpretationIds).toEqual([i.id]);
  });

  it('confidence carries through unchanged', () => {
    const out = buildLearningInfluences([interp('WEAK_COMPLETION_PATTERN', 'MEDIUM', 0.5)]);
    expect(out[0].confidence).toBe(0.5);
  });

  it('id has no timestamp (stable, identity-only)', () => {
    const id = buildLearningInfluences([interp('STRONG_COMPLETION_PATTERN', 'HIGH')])[0].id;
    expect(id).toBe('influence:global:COMPLETION_BOOST');
    expect(id).not.toMatch(/\d{4}|\d{10,}/); // no year / epoch-like digits
  });

  it('is deterministic — same input → identical output', () => {
    const input = [interp('STRONG_COMPLETION_PATTERN', 'HIGH'), interp('ELEVATED_FAILURE_PATTERN', 'MEDIUM')];
    expect(buildLearningInfluences(input)).toEqual(buildLearningInfluences(input));
  });

  it('does not mutate the input', () => {
    const input = [interp('STRONG_COMPLETION_PATTERN', 'HIGH'), interp('ELEVATED_IGNORE_PATTERN', 'LOW')];
    const snapshot = JSON.stringify(input);
    buildLearningInfluences(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('F7C leaf-node safety — no scoring/ranking imports', () => {
  const files = ['LearningInfluence.ts', 'buildLearningInfluences.ts'];
  const forbidden = ['scoreDecision', 'topActionsRanking', 'getTopActionsToday', 'ScoreContext', '/ranking/'];

  it.each(files)('%s does not import scoring/ranking/topActions modules', (file) => {
    const src = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
    // Only inspect import statements — comments may legitimately mention these names.
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    for (const token of forbidden) {
      expect(importLines.join('\n')).not.toContain(token);
    }
  });
});
