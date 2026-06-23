import { describe, it, expect } from 'vitest';
import type { QueueItem } from '../queue/QueueItem';
import { buildOutcomeRecord } from './buildOutcomeRecord';
import type { OutcomeStatus } from './OutcomeRecord';

function qi(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q:prep:d1',
    preparedActionId: 'prep:d1',
    sourceTopActionId: 'd1',
    status: 'READY',
    approvalState: 'NOT_REQUIRED',
    approvalKind: 'none',
    preparedActionType: 'READY_PICKUP',
    ...over,
  };
}

describe('buildOutcomeRecord — projection + linkage', () => {
  it('derives a deterministic id and carries linkage through', () => {
    const r = buildOutcomeRecord(qi({ id: 'q:prep:attention:r1', preparedActionId: 'prep:attention:r1', sourceTopActionId: 'attention:r1' }), 'COMPLETED');
    expect(r.id).toBe('outcome:q:prep:attention:r1');
    expect(r.queueItemId).toBe('q:prep:attention:r1');
    expect(r.preparedActionId).toBe('prep:attention:r1');
    expect(r.sourceTopActionId).toBe('attention:r1');
    expect(r.outcomeStatus).toBe('COMPLETED');
  });

  it('accepts every allowed status (no auto-success logic)', () => {
    for (const s of ['COMPLETED', 'FAILED', 'CANCELLED', 'IGNORED'] as OutcomeStatus[]) {
      expect(buildOutcomeRecord(qi(), s).outcomeStatus).toBe(s);
    }
  });

  it('includes reason/notes only when supplied', () => {
    const bare = buildOutcomeRecord(qi(), 'FAILED');
    expect('reason' in bare).toBe(false);
    expect('notes' in bare).toBe(false);
    const full = buildOutcomeRecord(qi(), 'FAILED', { reason: 'no answer', notes: 'retry tomorrow' });
    expect(full.reason).toBe('no answer');
    expect(full.notes).toBe('retry tomorrow');
  });

  it('throws on an invalid status (validation only)', () => {
    expect(() => buildOutcomeRecord(qi(), 'DONE' as unknown as OutcomeStatus)).toThrow();
  });

  it('is deterministic and does not mutate the queue item', () => {
    const item = qi();
    const snapshot = JSON.stringify(item);
    expect(buildOutcomeRecord(item, 'COMPLETED')).toEqual(buildOutcomeRecord(item, 'COMPLETED'));
    expect(JSON.stringify(item)).toBe(snapshot);
  });
});
