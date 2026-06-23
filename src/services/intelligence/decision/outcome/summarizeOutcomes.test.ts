import { describe, it, expect } from 'vitest';
import type { OutcomeRecord, OutcomeStatus } from './OutcomeRecord';
import { summarizeOutcomes, deriveOutcomeHealth } from './summarizeOutcomes';

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

describe('summarizeOutcomes — counts + completionRate', () => {
  it('empty set → all zero, rate 0 (divide-by-zero guard), POOR', () => {
    const s = summarizeOutcomes([]);
    expect(s).toEqual({
      total: 0, completed: 0, failed: 0, cancelled: 0, ignored: 0, completionRate: 0, health: 'POOR',
    });
  });

  it('counts every status bucket', () => {
    const s = summarizeOutcomes([
      rec('COMPLETED'), rec('COMPLETED'), rec('FAILED'), rec('CANCELLED'), rec('IGNORED'),
    ]);
    expect(s.total).toBe(5);
    expect(s.completed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.ignored).toBe(1);
    expect(s.completionRate).toBeCloseTo(2 / 5, 10);
  });
});

describe('outcome health bands', () => {
  it('GOOD when completionRate >= 0.80', () => {
    const s = summarizeOutcomes([rec('COMPLETED'), rec('COMPLETED'), rec('COMPLETED'), rec('COMPLETED'), rec('FAILED')]);
    expect(s.completionRate).toBeCloseTo(0.8, 10);
    expect(s.health).toBe('GOOD');
  });

  it('MIXED when 0.50 <= rate < 0.80', () => {
    const s = summarizeOutcomes([rec('COMPLETED'), rec('FAILED')]);
    expect(s.completionRate).toBe(0.5);
    expect(s.health).toBe('MIXED');
  });

  it('POOR when rate < 0.50', () => {
    const s = summarizeOutcomes([rec('COMPLETED'), rec('FAILED'), rec('FAILED')]);
    expect(s.health).toBe('POOR');
  });

  it('deriveOutcomeHealth boundaries', () => {
    expect(deriveOutcomeHealth(0.8)).toBe('GOOD');
    expect(deriveOutcomeHealth(0.79)).toBe('MIXED');
    expect(deriveOutcomeHealth(0.5)).toBe('MIXED');
    expect(deriveOutcomeHealth(0.49)).toBe('POOR');
    expect(deriveOutcomeHealth(0)).toBe('POOR');
    expect(deriveOutcomeHealth(1)).toBe('GOOD');
  });
});

describe('summarizeOutcomes — purity', () => {
  it('is deterministic — same input → equal output', () => {
    const records = [rec('COMPLETED'), rec('IGNORED')];
    expect(summarizeOutcomes(records)).toEqual(summarizeOutcomes(records));
  });

  it('does not mutate input', () => {
    const records = [rec('COMPLETED'), rec('FAILED')];
    const snapshot = JSON.stringify(records);
    summarizeOutcomes(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});
