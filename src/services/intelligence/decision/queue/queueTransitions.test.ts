import { describe, it, expect } from 'vitest';
import type { QueueItem, QueueStatus, QueueApprovalState } from './QueueItem';
import {
  approveQueueItem,
  denyQueueItem,
  blockQueueItem,
  resetQueueItemApproval,
} from './queueTransitions';

// ── Fixture ───────────────────────────────────────────────
function item(status: QueueStatus, approvalState: QueueApprovalState, over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q:prep:d1',
    preparedActionId: 'prep:d1',
    sourceTopActionId: 'd1',
    status,
    approvalState,
    approvalKind: approvalState === 'NOT_REQUIRED' ? 'none' : 'soft-queue',
    preparedActionType: 'GENERIC',
    ...over,
  };
}

const waiting = () => item('PENDING', 'WAITING');
const ready = () => item('READY', 'NOT_REQUIRED');

describe('approveQueueItem', () => {
  it('WAITING → APPROVED / READY', () => {
    const q = approveQueueItem(waiting());
    expect(q.approvalState).toBe('APPROVED');
    expect(q.status).toBe('READY');
  });

  it('NOT_REQUIRED is a no-op (returns same reference)', () => {
    const r = ready();
    expect(approveQueueItem(r)).toBe(r);
  });

  it('DENIED cannot be approved directly (no-op)', () => {
    const d = item('BLOCKED', 'DENIED');
    expect(approveQueueItem(d)).toBe(d);
  });

  it('BLOCKED cannot be approved directly even if approvalState WAITING (no-op)', () => {
    const b = item('BLOCKED', 'WAITING', { blockReason: 'inventory hold' });
    expect(approveQueueItem(b)).toBe(b);
  });

  it('already APPROVED is idempotent no-op', () => {
    const a = item('READY', 'APPROVED');
    expect(approveQueueItem(a)).toBe(a);
  });
});

describe('denyQueueItem', () => {
  it('WAITING → DENIED / BLOCKED with reason', () => {
    const q = denyQueueItem(waiting(), 'over budget');
    expect(q.approvalState).toBe('DENIED');
    expect(q.status).toBe('BLOCKED');
    expect(q.denialReason).toBe('over budget');
  });

  it('WAITING → DENIED without reason leaves denialReason undefined', () => {
    const q = denyQueueItem(waiting());
    expect(q.approvalState).toBe('DENIED');
    expect('denialReason' in q).toBe(false);
  });

  it('NOT_REQUIRED is a no-op (returns same reference)', () => {
    const r = ready();
    expect(denyQueueItem(r, 'x')).toBe(r);
  });
});

describe('blockQueueItem', () => {
  it('sets status BLOCKED and preserves approvalState', () => {
    const q = blockQueueItem(waiting(), 'parts backordered');
    expect(q.status).toBe('BLOCKED');
    expect(q.approvalState).toBe('WAITING'); // preserved
    expect(q.blockReason).toBe('parts backordered');
  });

  it('preserves an APPROVED approvalState when blocked', () => {
    const q = blockQueueItem(item('READY', 'APPROVED'), 'store closed');
    expect(q.status).toBe('BLOCKED');
    expect(q.approvalState).toBe('APPROVED');
  });

  it('idempotent no-op when already blocked with same reason', () => {
    const b = blockQueueItem(waiting(), 'hold');
    expect(blockQueueItem(b, 'hold')).toBe(b);
  });
});

describe('resetQueueItemApproval', () => {
  it('DENIED → WAITING / PENDING and clears denialReason', () => {
    const q = resetQueueItemApproval(denyQueueItem(waiting(), 'nope'));
    expect(q.approvalState).toBe('WAITING');
    expect(q.status).toBe('PENDING');
    expect('denialReason' in q).toBe(false);
  });

  it('APPROVED → WAITING / PENDING', () => {
    const q = resetQueueItemApproval(item('READY', 'APPROVED'));
    expect(q.approvalState).toBe('WAITING');
    expect(q.status).toBe('PENDING');
  });

  it('NOT_REQUIRED is a no-op (returns same reference)', () => {
    const r = ready();
    expect(resetQueueItemApproval(r)).toBe(r);
  });

  it('WAITING is a no-op (returns same reference)', () => {
    const w = waiting();
    expect(resetQueueItemApproval(w)).toBe(w);
  });
});

describe('purity — no mutation of the original object', () => {
  it('approve/deny/block/reset never mutate their input', () => {
    const original = waiting();
    const snapshot = JSON.stringify(original);
    approveQueueItem(original);
    denyQueueItem(original, 'r');
    blockQueueItem(original, 'b');
    resetQueueItemApproval(item('BLOCKED', 'DENIED', { denialReason: 'x' }));
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('is deterministic — repeated calls produce equal output', () => {
    expect(approveQueueItem(waiting())).toEqual(approveQueueItem(waiting()));
    expect(denyQueueItem(waiting(), 'r')).toEqual(denyQueueItem(waiting(), 'r'));
  });
});
