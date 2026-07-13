// ============================================================
// R-INTEL-V2-PHASE5 — AR follow-up cadence detector.
// Pure-function tests: no localStorage, no clock — `now` is injected and
// events are built inline, so every case is fully deterministic.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  computeArFollowUps,
  isCollectible,
  FOLLOW_UP_DAYS,
  FOLLOW_UP_MAX,
} from './arFollowUps';
import type { ArFollowUpSourceRecord } from './arFollowUps';
import type { ArReminderEvent } from './arReminderStore';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 13, 12, 0, 0); // fixed reference "now"

function rec(id: string, balanceCents: number, status?: string): ArFollowUpSourceRecord {
  return { id, balanceCents, ...(status !== undefined ? { status } : {}) };
}

function ev(entityId: string, ageMs: number, balanceCents: number, n = 0): ArReminderEvent {
  return {
    id: `ev-${entityId}-${n}`,
    type: 'ar_reminder_whatsapp_opened',
    channel: 'whatsapp',
    customerName: 'Test Customer',
    entityType: 'repair',
    entityId,
    balanceCents,
    language: 'en',
    messagePreview: 'preview',
    timestamp: NOW - ageMs,
    source: 'unpaid_balances',
  };
}

describe('computeArFollowUps — inclusion rules', () => {
  it('excludes records with no reminder', () => {
    const out = computeArFollowUps([rec('r1', 5000)], [ev('other', 10 * DAY_MS, 5000)], NOW);
    expect(out).toEqual([]);
  });

  it('excludes reminders younger than 7 days', () => {
    const out = computeArFollowUps([rec('r1', 5000)], [ev('r1', 3 * DAY_MS, 5000)], NOW);
    expect(out).toEqual([]);
  });

  it('includes a reminder exactly 7 days old (boundary inclusive)', () => {
    const out = computeArFollowUps([rec('r1', 5000)], [ev('r1', FOLLOW_UP_DAYS * DAY_MS, 5000)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].record.id).toBe('r1');
    expect(out[0].daysSinceReminder).toBe(7);
  });

  it('excludes a reminder at 6 days 23 hours 59 minutes (one minute short)', () => {
    const age = FOLLOW_UP_DAYS * DAY_MS - 60_000;
    const out = computeArFollowUps([rec('r1', 5000)], [ev('r1', age, 5000)], NOW);
    expect(out).toEqual([]);
  });

  it('excludes zero-balance records even with a stale reminder', () => {
    const out = computeArFollowUps([rec('r1', 0)], [ev('r1', 10 * DAY_MS, 5000)], NOW);
    expect(out).toEqual([]);
  });

  it('excludes terminal / non-collectible records (existing unpaid-balance rule)', () => {
    for (const status of ['cancelled', 'canceled', 'refunded', 'forfeited', 'voided']) {
      const out = computeArFollowUps([rec('r1', 5000, status)], [ev('r1', 10 * DAY_MS, 5000)], NOW);
      expect(out, status).toEqual([]);
    }
    // Sanity: an active status with the same data IS included.
    const ok = computeArFollowUps([rec('r1', 5000, 'ready')], [ev('r1', 10 * DAY_MS, 5000)], NOW);
    expect(ok).toHaveLength(1);
  });
});

describe('computeArFollowUps — reminder history', () => {
  it('uses the LATEST reminder when multiple exist (staleness measured from it)', () => {
    // Older reminder qualifies (20d), latest one (3d) does not → excluded.
    const events = [ev('r1', 20 * DAY_MS, 5000, 1), ev('r1', 3 * DAY_MS, 5000, 2)];
    expect(computeArFollowUps([rec('r1', 5000)], events, NOW)).toEqual([]);

    // Both stale → latest (8d) drives daysSinceReminder, not the 20d one.
    const events2 = [ev('r1', 20 * DAY_MS, 5000, 1), ev('r1', 8 * DAY_MS, 5000, 2)];
    const out = computeArFollowUps([rec('r1', 5000)], events2, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].daysSinceReminder).toBe(8);
    expect(out[0].lastReminder.id).toBe('ev-r1-2');
  });

  it('attemptNumber equals existing reminder count + 1', () => {
    const events = [ev('r1', 30 * DAY_MS, 5000, 1), ev('r1', 20 * DAY_MS, 5000, 2), ev('r1', 9 * DAY_MS, 5000, 3)];
    const out = computeArFollowUps([rec('r1', 5000)], events, NOW);
    expect(out[0].reminderCount).toBe(3);
    expect(out[0].attemptNumber).toBe(4);
  });
});

describe('computeArFollowUps — partial-payment indicator (display-only)', () => {
  it('flags balanceDecreased when the reminder snapshot is greater than the current balance', () => {
    const out = computeArFollowUps([rec('r1', 3000)], [ev('r1', 10 * DAY_MS, 5000)], NOW);
    expect(out[0].balanceDecreased).toBe(true);
  });

  it('does NOT flag when balances are equal', () => {
    const out = computeArFollowUps([rec('r1', 5000)], [ev('r1', 10 * DAY_MS, 5000)], NOW);
    expect(out[0].balanceDecreased).toBe(false);
  });
});

describe('computeArFollowUps — ordering, cap, determinism', () => {
  it('sorts by current balance descending', () => {
    const records = [rec('a', 1000), rec('b', 9000), rec('c', 4000)];
    const events = [ev('a', 10 * DAY_MS, 1000), ev('b', 10 * DAY_MS, 9000), ev('c', 10 * DAY_MS, 4000)];
    const out = computeArFollowUps(records, events, NOW);
    expect(out.map((f) => f.record.id)).toEqual(['b', 'c', 'a']);
  });

  it('caps the result at FOLLOW_UP_MAX (5)', () => {
    const records = Array.from({ length: 8 }, (_, i) => rec(`r${i}`, (i + 1) * 1000));
    const events = records.map((r, i) => ev(r.id, 10 * DAY_MS, r.balanceCents, i));
    const out = computeArFollowUps(records, events, NOW);
    expect(out).toHaveLength(FOLLOW_UP_MAX);
    // Highest balances survive the cap.
    expect(out.map((f) => f.record.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3']);
  });

  it('is deterministic for the same injected now (and ties break stably)', () => {
    const records = [rec('b', 5000), rec('a', 5000)];
    const events = [ev('a', 10 * DAY_MS, 5000), ev('b', 10 * DAY_MS, 5000)];
    const one = computeArFollowUps(records, events, NOW);
    const two = computeArFollowUps(records, events, NOW);
    expect(one.map((f) => f.record.id)).toEqual(two.map((f) => f.record.id));
    // Equal balance + equal reminder age → id ascending.
    expect(one.map((f) => f.record.id)).toEqual(['a', 'b']);
  });
});

describe('isCollectible (shared AR rule — moved from unpaidBalances)', () => {
  it('keeps the original semantics: positive balance + non-terminal status', () => {
    expect(isCollectible('ready', 100)).toBe(true);
    expect(isCollectible('', 100)).toBe(true);          // missing status → collectible
    expect(isCollectible('ready', 0)).toBe(false);
    expect(isCollectible('ready', -50)).toBe(false);
    expect(isCollectible('Refunded', 100)).toBe(false); // case-insensitive
    expect(isCollectible(undefined, 100)).toBe(true);
  });
});
