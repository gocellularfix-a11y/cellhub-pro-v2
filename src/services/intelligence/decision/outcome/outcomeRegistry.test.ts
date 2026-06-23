import { describe, it, expect } from 'vitest';
import type { OutcomeRecord, OutcomeStatus } from './OutcomeRecord';
import { summarizeOutcomes } from './summarizeOutcomes';
import {
  createOutcomeRegistry,
  getCompletedOutcomes,
  getFailedOutcomes,
  getCancelledOutcomes,
  getIgnoredOutcomes,
  summarizeOutcomeRegistry,
  registryHasOutcomes,
} from './outcomeRegistry';

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

describe('createOutcomeRegistry', () => {
  it('empty input → empty registry, no latestRecordId', () => {
    const reg = createOutcomeRegistry([]);
    expect(reg.records).toEqual([]);
    expect(reg.totalRecords).toBe(0);
    expect('latestRecordId' in reg).toBe(false);
    expect(registryHasOutcomes(reg)).toBe(false);
  });

  it('preserves input order and sets latestRecordId to the last record', () => {
    const a = rec('COMPLETED'), b = rec('FAILED'), c = rec('IGNORED');
    const reg = createOutcomeRegistry([a, b, c]);
    expect(reg.records.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(reg.totalRecords).toBe(3);
    expect(reg.latestRecordId).toBe(c.id);
    expect(registryHasOutcomes(reg)).toBe(true);
  });

  it('takes a defensive copy — mutating the source array does not affect the registry', () => {
    const src = [rec('COMPLETED')];
    const reg = createOutcomeRegistry(src);
    src.push(rec('FAILED'));
    expect(reg.totalRecords).toBe(1);
  });

  it('does not mutate the input array', () => {
    const src = [rec('COMPLETED'), rec('FAILED')];
    const snapshot = JSON.stringify(src);
    createOutcomeRegistry(src);
    expect(JSON.stringify(src)).toBe(snapshot);
  });
});

describe('query helpers', () => {
  const reg = createOutcomeRegistry([
    rec('COMPLETED'), rec('COMPLETED'), rec('FAILED'), rec('CANCELLED'), rec('IGNORED'), rec('IGNORED'),
  ]);

  it('filter by each status', () => {
    expect(getCompletedOutcomes(reg)).toHaveLength(2);
    expect(getFailedOutcomes(reg)).toHaveLength(1);
    expect(getCancelledOutcomes(reg)).toHaveLength(1);
    expect(getIgnoredOutcomes(reg)).toHaveLength(2);
  });

  it('queries are read-only and deterministic', () => {
    expect(getCompletedOutcomes(reg)).toEqual(getCompletedOutcomes(reg));
    const snapshot = JSON.stringify(reg.records);
    getCompletedOutcomes(reg);
    getIgnoredOutcomes(reg);
    expect(JSON.stringify(reg.records)).toBe(snapshot);
  });
});

describe('summarizeOutcomeRegistry — reuses F6A', () => {
  it('matches summarizeOutcomes called directly on the records (no duplicated logic)', () => {
    const records = [rec('COMPLETED'), rec('COMPLETED'), rec('FAILED'), rec('IGNORED')];
    const reg = createOutcomeRegistry(records);
    expect(summarizeOutcomeRegistry(reg)).toEqual(summarizeOutcomes(records));
  });

  it('empty registry summary delegates correctly (rate 0, POOR)', () => {
    const s = summarizeOutcomeRegistry(createOutcomeRegistry([]));
    expect(s.total).toBe(0);
    expect(s.completionRate).toBe(0);
    expect(s.health).toBe('POOR');
  });
});
