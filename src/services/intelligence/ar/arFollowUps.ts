// ============================================================
// R-INTEL-V2-PHASE5-AR-FOLLOWUP-CADENCE
// Pure, deterministic detector for stale AR reminders: records that were
// reminded at least FOLLOW_UP_DAYS ago and STILL carry a collectible
// balance. Closes the collections loop built in Phases 0–2:
//   find → remind → track → (this) detect stale → follow up → collect.
//
// SAFETY CONTRACT (mirrors arReminderStore):
//   - Read-only over data the caller supplies. No localStorage access, no
//     clock (caller injects `now`), no randomness, no LLM, no persistence.
//   - NEVER claims a payment happened. `balanceDecreased` is a display-only
//     observation (reminder-time snapshot > current stored balance) — it is
//     not payment attribution and must never be presented as one.
//   - Money is integer cents, read as-is — never recalculated here.
// ============================================================

import type { ArReminderEvent } from './arReminderStore';

export const FOLLOW_UP_DAYS = 7;
export const FOLLOW_UP_MAX = 5;
const DAY_MS = 86_400_000;

// ── Shared AR collectibility rule ─────────────────────────
// Moved from chat/unpaidBalances.ts (single source of truth for the AR
// domain — the unpaid list and the follow-up detector must never disagree
// on what is collectible). Behavior is byte-identical to the original.

/** Statuses that mean the balance is no longer collectible (do not show). */
export const TERMINAL_STATUSES = new Set([
  'cancelled', 'canceled', 'refunded', 'forfeited', 'voided',
]);

export function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

export function isCollectible(status: unknown, balanceCents: number): boolean {
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) return false;
  return !TERMINAL_STATUSES.has(statusKey(status));
}

// ── Detector ──────────────────────────────────────────────

/**
 * Minimal structural shape the detector needs. chat/unpaidBalances' internal
 * UnpaidRecord satisfies it as-is; `status` is optional because the caller
 * may already have filtered terminal records (the detector re-checks
 * defensively when a status is present).
 */
export interface ArFollowUpSourceRecord {
  id: string;
  /** Current outstanding balance — integer cents, read as-is. */
  balanceCents: number;
  status?: unknown;
}

export interface ArFollowUpCandidate<T extends ArFollowUpSourceRecord = ArFollowUpSourceRecord> {
  record: T;
  /** The most recent reminder event for this entity. */
  lastReminder: ArReminderEvent;
  /** Reminder events already sent for this entity (within store retention). */
  reminderCount: number;
  /** The NEXT reminder's attempt number = reminderCount + 1. */
  attemptNumber: number;
  /** Whole days since the last reminder (floor). Always >= FOLLOW_UP_DAYS. */
  daysSinceReminder: number;
  /**
   * Display-only: the reminder-time balance snapshot is higher than the
   * current balance. NOT payment attribution — never present it as
   * "collected"; the deterministic modules own accounting truth.
   */
  balanceDecreased: boolean;
}

/**
 * Stale-reminder follow-up candidates. Pure and deterministic: same
 * (records, events, now) → same output.
 *
 * Rules:
 *   - collectible balance only (> 0 cents, non-terminal status when given)
 *   - at least one prior reminder for the entity
 *   - latest reminder is >= FOLLOW_UP_DAYS full days old (exactly 7 days
 *     qualifies; 6d 23h 59m does not)
 *   - sorted by current balance desc; ties → older reminder first, then id
 *   - capped at FOLLOW_UP_MAX
 */
export function computeArFollowUps<T extends ArFollowUpSourceRecord>(
  records: readonly T[],
  events: readonly ArReminderEvent[],
  now: number,
): ArFollowUpCandidate<T>[] {
  if (records.length === 0 || events.length === 0) return [];

  // Group reminder events by entityId once (mirrors getArReminders' lookup
  // key — the store already matches by entityId only).
  const byEntity = new Map<string, ArReminderEvent[]>();
  for (const e of events) {
    const arr = byEntity.get(e.entityId);
    if (arr) arr.push(e); else byEntity.set(e.entityId, [e]);
  }

  const out: ArFollowUpCandidate<T>[] = [];
  for (const record of records) {
    if (!isCollectible(record.status ?? '', record.balanceCents)) continue;

    const evs = byEntity.get(record.id);
    if (!evs || evs.length === 0) continue;

    let last = evs[0];
    for (const e of evs) if (e.timestamp > last.timestamp) last = e;

    const ageMs = now - last.timestamp;
    if (ageMs < FOLLOW_UP_DAYS * DAY_MS) continue;

    out.push({
      record,
      lastReminder: last,
      reminderCount: evs.length,
      attemptNumber: evs.length + 1,
      daysSinceReminder: Math.floor(ageMs / DAY_MS),
      balanceDecreased: last.balanceCents > record.balanceCents,
    });
  }

  out.sort((a, b) => {
    if (b.record.balanceCents !== a.record.balanceCents) {
      return b.record.balanceCents - a.record.balanceCents;
    }
    if (a.lastReminder.timestamp !== b.lastReminder.timestamp) {
      return a.lastReminder.timestamp - b.lastReminder.timestamp; // older first
    }
    return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
  });

  return out.slice(0, FOLLOW_UP_MAX);
}
