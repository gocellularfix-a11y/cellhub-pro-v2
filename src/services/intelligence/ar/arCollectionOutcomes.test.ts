// ============================================================
// R-INTEL-V2-PHASE8 — AR collections outcome visibility.
// Pure-function tests: no localStorage, no clock — `now` injected, events
// and entity snapshots built inline; fully deterministic.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  computeArCollectionOutcomes,
  selectArOutcomeDetailRows,
  AR_OUTCOME_LOOKBACK_DAYS,
  AR_OUTCOME_DETAIL_MAX,
} from './arCollectionOutcomes';
import type { ArOutcomeEntitySnapshot } from './arCollectionOutcomes';
import type { ArReminderEvent, ArReminderEntityType } from './arReminderStore';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 13, 12, 0, 0);

function ev(
  entityId: string,
  ageMs: number,
  balanceCents: number,
  entityType: ArReminderEntityType = 'repair',
  n = 0,
): ArReminderEvent {
  return {
    id: `ev-${entityType}-${entityId}-${n}`,
    type: 'ar_reminder_whatsapp_opened',
    channel: 'whatsapp',
    customerName: 'Event Customer',
    entityType,
    entityId,
    balanceCents,
    language: 'en',
    messagePreview: 'preview',
    timestamp: NOW - ageMs,
    source: 'unpaid_balances',
  };
}

function ent(
  id: string,
  balanceCents: number,
  status = 'ready',
  entityType: ArReminderEntityType = 'repair',
): ArOutcomeEntitySnapshot {
  return { entityType, id, balanceCents, status, customerName: 'Ana' };
}

describe('computeArCollectionOutcomes — classification', () => {
  it('no reminders → empty outcome', () => {
    const s = computeArCollectionOutcomes([ent('r1', 5000)], [], NOW);
    expect(s.outcomes).toEqual([]);
    expect(s.comparableCount).toBe(0);
    expect(s.totalObservedDecreaseCents).toBe(0);
  });

  it('one reminder, unchanged balance', () => {
    const s = computeArCollectionOutcomes([ent('r1', 5000)], [ev('r1', 5 * DAY_MS, 5000)], NOW);
    expect(s.outcomes[0].status).toBe('unchanged');
    expect(s.unchangedCount).toBe(1);
    expect(s.totalObservedDecreaseCents).toBe(0);
    expect(s.outcomes[0].observedDecreaseCents).toBe(0);
  });

  it('balance decreased → observed integer difference', () => {
    const s = computeArCollectionOutcomes([ent('r1', 4500)], [ev('r1', 5 * DAY_MS, 9000)], NOW);
    expect(s.outcomes[0].status).toBe('balance_decreased');
    expect(s.outcomes[0].observedDecreaseCents).toBe(4500);
    expect(Number.isInteger(s.outcomes[0].observedDecreaseCents)).toBe(true);
    expect(s.decreasedCount).toBe(1);
    expect(s.totalObservedDecreaseCents).toBe(4500);
  });

  it('balance increased → neutral classification, no decrease recorded', () => {
    const s = computeArCollectionOutcomes([ent('r1', 12000)], [ev('r1', 5 * DAY_MS, 9000)], NOW);
    expect(s.outcomes[0].status).toBe('balance_increased');
    expect(s.outcomes[0].observedDecreaseCents).toBe(0);
    expect(s.increasedCount).toBe(1);
    expect(s.totalObservedDecreaseCents).toBe(0);
  });

  it('current balance zero via a legitimate non-terminal state → resolved', () => {
    const s = computeArCollectionOutcomes([ent('r1', 0, 'picked_up')], [ev('r1', 5 * DAY_MS, 9000)], NOW);
    expect(s.outcomes[0].status).toBe('resolved');
    expect(s.outcomes[0].observedDecreaseCents).toBe(9000);
    expect(s.resolvedCount).toBe(1);
    expect(s.totalObservedDecreaseCents).toBe(9000);
  });

  it('terminal statuses are NEVER counted as collected', () => {
    for (const status of ['cancelled', 'voided', 'forfeited', 'refunded', 'canceled']) {
      const s = computeArCollectionOutcomes([ent('r1', 0, status)], [ev('r1', 5 * DAY_MS, 9000)], NOW);
      expect(s.outcomes[0].status, status).toBe('not_comparable');
      expect(s.resolvedCount, status).toBe(0);
      expect(s.decreasedCount, status).toBe(0);
      expect(s.totalObservedDecreaseCents, status).toBe(0);
      expect(s.comparableCount, status).toBe(0);
    }
  });

  it('missing entity fails safe — never interpreted as paid', () => {
    const s = computeArCollectionOutcomes([], [ev('ghost', 5 * DAY_MS, 9000)], NOW);
    expect(s.outcomes[0].status).toBe('entity_missing');
    expect(s.outcomes[0].currentBalanceCents).toBeNull();
    expect(s.missingCount).toBe(1);
    expect(s.resolvedCount).toBe(0);
    expect(s.totalObservedDecreaseCents).toBe(0);
    expect(s.comparableCount).toBe(0);
  });
});

describe('computeArCollectionOutcomes — reminder history handling', () => {
  it('uses the LATEST reminder snapshot when multiple reminders exist', () => {
    const events = [
      ev('r1', 30 * DAY_MS, 9000, 'repair', 1), // old snapshot $90
      ev('r1', 5 * DAY_MS, 6000, 'repair', 2),  // latest snapshot $60
    ];
    const s = computeArCollectionOutcomes([ent('r1', 4500)], events, NOW);
    expect(s.outcomes).toHaveLength(1);
    expect(s.outcomes[0].snapshotCents).toBe(6000);         // latest, not the old one
    expect(s.outcomes[0].observedDecreaseCents).toBe(1500); // 6000 - 4500, never summed
    expect(s.outcomes[0].reminderCount).toBe(2);
    expect(s.outcomes[0].lastReminder.id).toBe('ev-repair-r1-2');
  });

  it('the same entity is counted exactly once in aggregates', () => {
    const events = [
      ev('r1', 20 * DAY_MS, 9000, 'repair', 1),
      ev('r1', 10 * DAY_MS, 9000, 'repair', 2),
      ev('r1', 5 * DAY_MS, 9000, 'repair', 3),
    ];
    const s = computeArCollectionOutcomes([ent('r1', 9000)], events, NOW);
    expect(s.outcomes).toHaveLength(1);
    expect(s.unchangedCount).toBe(1);
  });

  it('different entity types with the same raw id do not collide', () => {
    const entities = [
      ent('X', 4500, 'ready', 'repair'),   // decreased from 9000
      ent('X', 9000, 'active', 'layaway'), // unchanged
    ];
    const events = [
      ev('X', 5 * DAY_MS, 9000, 'repair', 1),
      ev('X', 5 * DAY_MS, 9000, 'layaway', 2),
    ];
    const s = computeArCollectionOutcomes(entities, events, NOW);
    expect(s.outcomes).toHaveLength(2);
    expect(s.decreasedCount).toBe(1);
    expect(s.unchangedCount).toBe(1);
    const repair = s.outcomes.find((o) => o.entityType === 'repair');
    expect(repair?.observedDecreaseCents).toBe(4500);
  });

  it('aggregate decrease equals the exact sum of per-entity integer differences', () => {
    const entities = [ent('a', 1), ent('b', 4999), ent('c', 0, 'picked_up')];
    const events = [
      ev('a', 5 * DAY_MS, 12399, 'repair', 1), // -12398
      ev('b', 5 * DAY_MS, 5000, 'repair', 2),  // -1
      ev('c', 5 * DAY_MS, 333, 'repair', 3),   // resolved -333
    ];
    const s = computeArCollectionOutcomes(entities, events, NOW);
    expect(s.totalObservedDecreaseCents).toBe(12398 + 1 + 333);
    for (const o of s.outcomes) expect(Number.isInteger(o.observedDecreaseCents)).toBe(true);
  });

  it('respects the lookback boundary (inclusive at exactly 90 days)', () => {
    const atBoundary = computeArCollectionOutcomes(
      [ent('r1', 4500)], [ev('r1', AR_OUTCOME_LOOKBACK_DAYS * DAY_MS, 9000)], NOW,
    );
    expect(atBoundary.outcomes).toHaveLength(1);

    const past = computeArCollectionOutcomes(
      [ent('r1', 4500)], [ev('r1', AR_OUTCOME_LOOKBACK_DAYS * DAY_MS + 60_000, 9000)], NOW,
    );
    expect(past.outcomes).toEqual([]);
  });

  it('is deterministic with injected now', () => {
    const entities = [ent('a', 100), ent('b', 200)];
    const events = [ev('a', 5 * DAY_MS, 500, 'repair', 1), ev('b', 5 * DAY_MS, 500, 'repair', 2)];
    const one = computeArCollectionOutcomes(entities, events, NOW);
    const two = computeArCollectionOutcomes(entities, events, NOW);
    expect(one).toEqual(two);
  });

  it('never produces a negative observed decrease', () => {
    const entities = [ent('up', 9000), ent('same', 100), ent('down', 50)];
    const events = [
      ev('up', 5 * DAY_MS, 100, 'repair', 1),
      ev('same', 5 * DAY_MS, 100, 'repair', 2),
      ev('down', 5 * DAY_MS, 100, 'repair', 3),
    ];
    const s = computeArCollectionOutcomes(entities, events, NOW);
    for (const o of s.outcomes) expect(o.observedDecreaseCents).toBeGreaterThanOrEqual(0);
  });
});

describe('sorting and detail rows', () => {
  it('sorts by observed decrease desc, then current balance desc, then stable key', () => {
    const entities = [
      ent('small', 100),                 // decrease 400
      ent('big', 100),                   // decrease 8900
      ent('richer', 50_000),             // unchanged, large balance
      ent('b-tie', 100), ent('a-tie', 100), // identical → key tie-break
    ];
    const events = [
      ev('small', 5 * DAY_MS, 500, 'repair', 1),
      ev('big', 5 * DAY_MS, 9000, 'repair', 2),
      ev('richer', 5 * DAY_MS, 50_000, 'repair', 3),
      ev('b-tie', 5 * DAY_MS, 100, 'repair', 4),
      ev('a-tie', 5 * DAY_MS, 100, 'repair', 5),
    ];
    const s = computeArCollectionOutcomes(entities, events, NOW);
    expect(s.outcomes.map((o) => o.entityId)).toEqual(['big', 'small', 'richer', 'a-tie', 'b-tie']);
  });

  it('detail rows: movement only (decreased/resolved), capped at AR_OUTCOME_DETAIL_MAX', () => {
    const entities = [
      ...Array.from({ length: 7 }, (_, i) => ent(`d${i}`, 100)),
      ent('same', 500),
    ];
    const events = [
      ...Array.from({ length: 7 }, (_, i) => ev(`d${i}`, 5 * DAY_MS, 1000 + i, 'repair', i)),
      ev('same', 5 * DAY_MS, 500, 'repair', 99),
    ];
    const s = computeArCollectionOutcomes(entities, events, NOW);
    const rows = selectArOutcomeDetailRows(s);
    expect(rows).toHaveLength(AR_OUTCOME_DETAIL_MAX);
    for (const r of rows) expect(['balance_decreased', 'resolved']).toContain(r.status);
  });
});
