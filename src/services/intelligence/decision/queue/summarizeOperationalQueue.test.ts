import { describe, it, expect } from 'vitest';
import type { QueueItem, QueueStatus, QueueApprovalState } from './QueueItem';
import type { PreparedActionType } from '../preparation/PreparedAction';
import { summarizeOperationalQueue, deriveQueueHealth } from './summarizeOperationalQueue';

// ── Fixture ───────────────────────────────────────────────
let n = 0;
function qi(
  status: QueueStatus,
  approvalState: QueueApprovalState,
  type: PreparedActionType = 'GENERIC',
): QueueItem {
  n += 1;
  return {
    id: `q:prep:d${n}`,
    preparedActionId: `prep:d${n}`,
    sourceTopActionId: `d${n}`,
    status,
    approvalState,
    approvalKind: approvalState === 'NOT_REQUIRED' ? 'none' : 'soft-queue',
    preparedActionType: type,
  };
}

describe('summarizeOperationalQueue — empty', () => {
  it('zeroes everything and is HEALTHY on empty input', () => {
    const s = summarizeOperationalQueue([]);
    expect(s.totalItems).toBe(0);
    expect(s.readyItems + s.pendingItems + s.blockedItems).toBe(0);
    expect(s.waitingApproval + s.approved + s.denied + s.notRequired).toBe(0);
    expect(s.byType).toEqual({
      READY_PICKUP: 0, STALE_REPAIR: 0, OVERDUE_LAYAWAY: 0, OUTREACH: 0, PAYMENT_OPPORTUNITY: 0, GENERIC: 0,
    });
    expect(s.health).toBe('HEALTHY');
  });
});

describe('summarizeOperationalQueue — totals + approval counts', () => {
  it('counts status + approval buckets across a mix', () => {
    const items = [
      qi('READY', 'NOT_REQUIRED', 'READY_PICKUP'),
      qi('READY', 'APPROVED', 'OUTREACH'),
      qi('PENDING', 'WAITING', 'OVERDUE_LAYAWAY'),
      qi('BLOCKED', 'DENIED', 'PAYMENT_OPPORTUNITY'),
    ];
    const s = summarizeOperationalQueue(items);
    expect(s.totalItems).toBe(4);
    expect(s.readyItems).toBe(2);
    expect(s.pendingItems).toBe(1);
    expect(s.blockedItems).toBe(1);
    expect(s.waitingApproval).toBe(1);
    expect(s.approved).toBe(1);
    expect(s.denied).toBe(1);
    expect(s.notRequired).toBe(1);
  });
});

describe('summarizeOperationalQueue — type breakdown', () => {
  it('counts by PreparedAction type', () => {
    const items = [
      qi('READY', 'NOT_REQUIRED', 'READY_PICKUP'),
      qi('READY', 'NOT_REQUIRED', 'READY_PICKUP'),
      qi('PENDING', 'WAITING', 'STALE_REPAIR'),
      qi('READY', 'NOT_REQUIRED', 'GENERIC'),
    ];
    const s = summarizeOperationalQueue(items);
    expect(s.byType.READY_PICKUP).toBe(2);
    expect(s.byType.STALE_REPAIR).toBe(1);
    expect(s.byType.GENERIC).toBe(1);
    expect(s.byType.OUTREACH).toBe(0);
  });
});

describe('summarizeOperationalQueue — health', () => {
  it('HEALTHY when all ready and no approval waiting', () => {
    const s = summarizeOperationalQueue([qi('READY', 'NOT_REQUIRED'), qi('READY', 'APPROVED')]);
    expect(s.health).toBe('HEALTHY');
  });

  it('ATTENTION_NEEDED when something is waiting/pending (and nothing blocked)', () => {
    expect(summarizeOperationalQueue([qi('PENDING', 'WAITING')]).health).toBe('ATTENTION_NEEDED');
    expect(summarizeOperationalQueue([qi('READY', 'NOT_REQUIRED'), qi('PENDING', 'WAITING')]).health).toBe('ATTENTION_NEEDED');
  });

  it('BLOCKED takes precedence even if items are also waiting', () => {
    const s = summarizeOperationalQueue([qi('PENDING', 'WAITING'), qi('BLOCKED', 'DENIED')]);
    expect(s.health).toBe('BLOCKED');
  });

  it('deriveQueueHealth rule order is correct', () => {
    expect(deriveQueueHealth(1, 5, 5)).toBe('BLOCKED');
    expect(deriveQueueHealth(0, 1, 0)).toBe('ATTENTION_NEEDED');
    expect(deriveQueueHealth(0, 0, 1)).toBe('ATTENTION_NEEDED');
    expect(deriveQueueHealth(0, 0, 0)).toBe('HEALTHY');
  });
});

describe('summarizeOperationalQueue — purity', () => {
  it('is deterministic — same input → equal output', () => {
    const items = [qi('PENDING', 'WAITING', 'OUTREACH'), qi('BLOCKED', 'DENIED', 'GENERIC')];
    expect(summarizeOperationalQueue(items)).toEqual(summarizeOperationalQueue(items));
  });

  it('does not mutate the input array or items', () => {
    const items = [qi('READY', 'NOT_REQUIRED', 'READY_PICKUP'), qi('PENDING', 'WAITING', 'STALE_REPAIR')];
    const snapshot = JSON.stringify(items);
    summarizeOperationalQueue(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
