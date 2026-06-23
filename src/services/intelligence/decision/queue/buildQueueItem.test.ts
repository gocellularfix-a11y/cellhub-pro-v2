import { describe, it, expect } from 'vitest';
import type { PreparedAction } from '../preparation/PreparedAction';
import { buildQueueItem } from './buildQueueItem';

// ── Fixture ───────────────────────────────────────────────
let n = 0;
function prepared(over: Partial<PreparedAction> = {}): PreparedAction {
  n += 1;
  return {
    id: over.id ?? `prep:d${n}`,
    sourceTopActionId: over.sourceTopActionId ?? `d${n}`,
    type: 'OUTREACH',
    title: 'title',
    summary: 'summary',
    approvalRequired: false,
    approvalKind: 'none',
    draftContent: 'draft',
    financialSensitive: false,
    ...over,
  };
}

describe('buildQueueItem — id + linkage', () => {
  it('derives a deterministic id and carries through linkage', () => {
    const p = prepared({ id: 'prep:attention:r1', sourceTopActionId: 'attention:r1' });
    const q = buildQueueItem(p);
    expect(q.id).toBe('q:prep:attention:r1');
    expect(q.preparedActionId).toBe('prep:attention:r1');
    expect(q.sourceTopActionId).toBe('attention:r1');
  });

  it('carries preparedActionType verbatim from the PreparedAction (no inference)', () => {
    expect(buildQueueItem(prepared({ type: 'READY_PICKUP' })).preparedActionType).toBe('READY_PICKUP');
    expect(buildQueueItem(prepared({ type: 'GENERIC' })).preparedActionType).toBe('GENERIC');
  });
});

describe('buildQueueItem — status + approval mapping', () => {
  it('approvalRequired=false → READY / NOT_REQUIRED', () => {
    const q = buildQueueItem(prepared({ approvalRequired: false, approvalKind: 'none' }));
    expect(q.status).toBe('READY');
    expect(q.approvalState).toBe('NOT_REQUIRED');
  });

  it('approvalRequired=true → PENDING / WAITING', () => {
    const q = buildQueueItem(prepared({ approvalRequired: true, approvalKind: 'soft-queue' }));
    expect(q.status).toBe('PENDING');
    expect(q.approvalState).toBe('WAITING');
  });

  it('carries approvalKind through (soft-queue / hard-gate)', () => {
    expect(buildQueueItem(prepared({ approvalRequired: true, approvalKind: 'hard-gate' })).approvalKind).toBe('hard-gate');
    expect(buildQueueItem(prepared({ approvalKind: 'none' })).approvalKind).toBe('none');
  });

  it('never emits reserved states (BLOCKED / APPROVED / DENIED) in F5A', () => {
    for (const req of [true, false]) {
      const q = buildQueueItem(prepared({ approvalRequired: req }));
      expect(q.status).not.toBe('BLOCKED');
      expect(['NOT_REQUIRED', 'WAITING']).toContain(q.approvalState);
    }
  });
});

describe('buildQueueItem — timestamp stability', () => {
  it('no timestamps by default (identity-stable)', () => {
    const q = buildQueueItem(prepared());
    expect(q.createdAt).toBeUndefined();
    expect(q.queuedAt).toBeUndefined();
    expect('createdAt' in q).toBe(false);
    expect('queuedAt' in q).toBe(false);
  });

  it('stamps createdAt + queuedAt ONLY when now is explicitly provided', () => {
    const q = buildQueueItem(prepared(), { now: 555 });
    expect(q.createdAt).toBe(555);
    expect(q.queuedAt).toBe(555);
  });

  it('is deterministic — repeated calls produce identical output', () => {
    const p = prepared({ id: 'prep:x', sourceTopActionId: 'x', approvalRequired: true, approvalKind: 'soft-queue' });
    expect(buildQueueItem(p)).toEqual(buildQueueItem(p));
  });
});
