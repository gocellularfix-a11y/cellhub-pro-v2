// ============================================================
// R-INTEL-V2-PHASE8-AR-OUTCOME-VISIBILITY
// Pure, deterministic comparison between the balance snapshot stored on
// each AR reminder event (Phase 1B) and the CURRENT stored balance of the
// same entity. Answers "are these reminders producing movement?" with
// observed facts only.
//
// SAFETY CONTRACT (the most important part of this module):
//   - This module NEVER claims causation. It reports that a stored balance
//     is lower/equal/higher than it was when a reminder was sent — nothing
//     about WHY. No "recovered", no "collected because", no conversion
//     rates. Callers must keep that wording contract.
//   - Read-only over caller-supplied data. No localStorage, no clock
//     (caller injects `now`), no randomness, no persistence, no accounting
//     entries. The deterministic modules own every balance mutation.
//   - Money is integer cents; the only arithmetic is integer subtraction
//     for a display-only observed difference.
//   - Fail safe: a missing entity is NEVER interpreted as paid; terminal
//     statuses (cancelled / voided / forfeited / refunded) are NEVER
//     counted as collected — they are excluded from money aggregates.
// ============================================================

import type { ArReminderEvent, ArReminderEntityType } from './arReminderStore';
import { TERMINAL_STATUSES, statusKey } from './arFollowUps';

/** Mirrors the reminder store's retention window (RETENTION_DAYS = 90). */
export const AR_OUTCOME_LOOKBACK_DAYS = 90;
/** Max detail rows a chat surface should render. */
export const AR_OUTCOME_DETAIL_MAX = 5;
const DAY_MS = 86_400_000;

export type ArOutcomeStatus =
  | 'balance_decreased'   // current > 0 and lower than the reminder snapshot
  | 'unchanged'           // current === snapshot
  | 'balance_increased'   // current > snapshot (reported neutrally)
  | 'resolved'            // current === 0 via a legitimate NON-terminal state
  | 'entity_missing'      // entity no longer found — fail safe, never "paid"
  | 'not_comparable';     // terminal status or unusable snapshot — excluded

/**
 * Minimal current-truth snapshot of one AR entity. The caller builds these
 * from the deterministic store records (repairs / layaways / special orders
 * / unlocks) — balance read as-is, never recalculated here.
 */
export interface ArOutcomeEntitySnapshot {
  entityType: ArReminderEntityType;
  id: string;
  /** Current stored balance — integer cents, as-is. */
  balanceCents: number;
  status?: unknown;
  customerName?: string;
}

export interface ArCollectionOutcome {
  entityType: ArReminderEntityType;
  entityId: string;
  customerName: string;
  /** Latest reminder event for this entity (the comparison baseline). */
  lastReminder: ArReminderEvent;
  reminderCount: number;
  /** Balance at reminder time — integer cents, from the event snapshot. */
  snapshotCents: number;
  /** Current stored balance — null only for entity_missing. */
  currentBalanceCents: number | null;
  status: ArOutcomeStatus;
  /**
   * Display-only observed difference (snapshot − current), integer cents,
   * always >= 0. Set only for balance_decreased and resolved. NOT payment
   * attribution — never present it as "collected/recovered".
   */
  observedDecreaseCents: number;
}

export interface ArCollectionOutcomeSummary {
  /** All outcomes, deterministically sorted (see sort contract below). */
  outcomes: ArCollectionOutcome[];
  decreasedCount: number;
  unchangedCount: number;
  increasedCount: number;
  resolvedCount: number;
  /** Entities whose reminder exists but current truth is unusable. */
  missingCount: number;
  notComparableCount: number;
  /** decreased + unchanged + increased + resolved. */
  comparableCount: number;
  /**
   * Exact integer sum of per-entity observed decreases (decreased +
   * resolved rows). Display-only — an observed reduction of stored
   * balances, never a claim that anything was collected.
   */
  totalObservedDecreaseCents: number;
}

const outcomeKey = (t: string, id: string) => `${t}:${id}`;

/**
 * Compare the latest in-lookback reminder snapshot per entity against the
 * current stored balance. Pure and deterministic: same (entities, events,
 * now) → same output.
 *
 * Rules:
 *   - events older than AR_OUTCOME_LOOKBACK_DAYS are ignored (mirrors the
 *     store's retention; boundary inclusive)
 *   - one outcome per (entityType, entityId) — raw ids can repeat across
 *     domains without colliding; latest reminder wins as baseline
 *   - terminal statuses → not_comparable; missing entity → entity_missing;
 *     neither ever contributes to money aggregates
 *   - sort: largest observed decrease desc → largest current balance desc
 *     → entityType:id asc (stable deterministic tie-break)
 */
export function computeArCollectionOutcomes(
  entities: readonly ArOutcomeEntitySnapshot[],
  events: readonly ArReminderEvent[],
  now: number,
): ArCollectionOutcomeSummary {
  const empty: ArCollectionOutcomeSummary = {
    outcomes: [],
    decreasedCount: 0, unchangedCount: 0, increasedCount: 0, resolvedCount: 0,
    missingCount: 0, notComparableCount: 0, comparableCount: 0,
    totalObservedDecreaseCents: 0,
  };
  if (events.length === 0) return empty;

  // Current truth, keyed by (entityType, entityId).
  const entityByKey = new Map<string, ArOutcomeEntitySnapshot>();
  for (const e of entities) entityByKey.set(outcomeKey(e.entityType, e.id), e);

  // Latest in-lookback reminder + count per (entityType, entityId).
  const latestByKey = new Map<string, { last: ArReminderEvent; count: number }>();
  for (const ev of events) {
    if (now - ev.timestamp > AR_OUTCOME_LOOKBACK_DAYS * DAY_MS) continue;
    const k = outcomeKey(ev.entityType, ev.entityId);
    const cur = latestByKey.get(k);
    if (!cur) latestByKey.set(k, { last: ev, count: 1 });
    else {
      cur.count += 1;
      if (ev.timestamp > cur.last.timestamp) cur.last = ev;
    }
  }
  if (latestByKey.size === 0) return empty;

  const outcomes: ArCollectionOutcome[] = [];
  for (const [k, { last, count }] of latestByKey) {
    const entity = entityByKey.get(k);
    const snapshotCents = last.balanceCents;

    let status: ArOutcomeStatus;
    let currentBalanceCents: number | null;
    let observedDecreaseCents = 0;

    if (!entity) {
      status = 'entity_missing';                     // fail safe — never "paid"
      currentBalanceCents = null;
    } else {
      currentBalanceCents = Math.max(0, entity.balanceCents || 0);
      const terminal = TERMINAL_STATUSES.has(statusKey(entity.status ?? ''));
      if (terminal || !Number.isFinite(snapshotCents) || snapshotCents <= 0) {
        status = 'not_comparable';                   // never counted as collected
      } else if (currentBalanceCents === 0) {
        status = 'resolved';                         // legitimate non-terminal zero
        observedDecreaseCents = snapshotCents;
      } else if (currentBalanceCents < snapshotCents) {
        status = 'balance_decreased';
        observedDecreaseCents = snapshotCents - currentBalanceCents;
      } else if (currentBalanceCents === snapshotCents) {
        status = 'unchanged';
      } else {
        status = 'balance_increased';                // neutral — not a failure state
      }
    }

    outcomes.push({
      entityType: last.entityType,
      entityId: last.entityId,
      customerName: entity?.customerName || last.customerName || '',
      lastReminder: last,
      reminderCount: count,
      snapshotCents,
      currentBalanceCents,
      status,
      observedDecreaseCents,
    });
  }

  outcomes.sort((a, b) => {
    if (b.observedDecreaseCents !== a.observedDecreaseCents) {
      return b.observedDecreaseCents - a.observedDecreaseCents;
    }
    const ab = a.currentBalanceCents ?? -1;
    const bb = b.currentBalanceCents ?? -1;
    if (bb !== ab) return bb - ab;
    const ak = outcomeKey(a.entityType, a.entityId);
    const bk = outcomeKey(b.entityType, b.entityId);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  let decreasedCount = 0, unchangedCount = 0, increasedCount = 0, resolvedCount = 0,
      missingCount = 0, notComparableCount = 0, totalObservedDecreaseCents = 0;
  for (const o of outcomes) {
    switch (o.status) {
      case 'balance_decreased': decreasedCount += 1; totalObservedDecreaseCents += o.observedDecreaseCents; break;
      case 'unchanged':         unchangedCount += 1; break;
      case 'balance_increased': increasedCount += 1; break;
      case 'resolved':          resolvedCount += 1; totalObservedDecreaseCents += o.observedDecreaseCents; break;
      case 'entity_missing':    missingCount += 1; break;
      case 'not_comparable':    notComparableCount += 1; break;
    }
  }

  return {
    outcomes,
    decreasedCount, unchangedCount, increasedCount, resolvedCount,
    missingCount, notComparableCount,
    comparableCount: decreasedCount + unchangedCount + increasedCount + resolvedCount,
    totalObservedDecreaseCents,
  };
}

/**
 * Detail rows worth showing in chat: observed movement only (decreased /
 * resolved), already in sort order, capped at AR_OUTCOME_DETAIL_MAX.
 */
export function selectArOutcomeDetailRows(
  summary: ArCollectionOutcomeSummary,
): ArCollectionOutcome[] {
  return summary.outcomes
    .filter((o) => o.status === 'balance_decreased' || o.status === 'resolved')
    .slice(0, AR_OUTCOME_DETAIL_MAX);
}
