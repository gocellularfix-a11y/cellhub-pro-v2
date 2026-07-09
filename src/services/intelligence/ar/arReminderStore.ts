// ============================================================
// R-INTEL-V2-PHASE1B-AR-REMINDER-TRACKING
// Append-only localStorage store for accounts-receivable reminder outreach
// events. Mirrors the established intelligence store pattern (outreachOutcomeStore
// / paymentCampaignStore): a single versioned key, parse-guarded reads,
// best-effort quota-safe writes, a hard cap, and a read-time retention window.
//
// SAFETY CONTRACT:
//   - This store ONLY records that a reminder was opened/copied.
//   - It NEVER records a payment, NEVER marks a balance collected, and NEVER
//     reads or mutates the source repair / layaway / unlock / special-order.
//   - balanceCents is the amount owed AT REMINDER TIME (a snapshot), integer
//     cents, read as-is from the row — never recalculated here.
//   - No AI/LLM, no network. Pure localStorage + integer math. Never throws.
// ============================================================

import { generateId } from '@/utils/dates';

const STORE_KEY = 'cellhub:intelligence:arReminders:v1';
const MAX_EVENTS = 2000;
const RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
const PREVIEW_MAX = 240;

export type ArReminderChannel = 'whatsapp' | 'copy';
export type ArReminderType = 'ar_reminder_whatsapp_opened' | 'ar_reminder_copied';
export type ArReminderEntityType = 'repair' | 'layaway' | 'unlock' | 'special_order';

export interface ArReminderEvent {
  id: string;
  type: ArReminderType;
  channel: ArReminderChannel;
  customerId?: string;
  customerName: string;
  phone?: string;
  entityType: ArReminderEntityType;
  entityId: string;
  /** Amount owed at reminder time — integer cents, never recalculated. */
  balanceCents: number;
  language: string;
  messagePreview: string;
  timestamp: number;
  source: 'unpaid_balances';
}

function readStore(): ArReminderEvent[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ArReminderEvent =>
        e !== null &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        (e.type === 'ar_reminder_whatsapp_opened' || e.type === 'ar_reminder_copied') &&
        typeof e.entityId === 'string' &&
        typeof e.balanceCents === 'number' &&
        typeof e.timestamp === 'number',
    );
  } catch {
    return [];
  }
}

function writeStore(events: ArReminderEvent[]): void {
  try {
    const trimmed = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / incognito / no-localStorage — best-effort, never throws */
  }
}

/** Collapse whitespace and truncate a message to a safe stored preview. */
export function buildMessagePreview(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX - 1)}…` : t;
}

/**
 * Append one AR reminder event. The caller supplies every field (no invented
 * data); this only stamps the id and persists. Never throws. Returns the
 * stored event so callers/tests can assert on it.
 */
export function recordArReminder(input: Omit<ArReminderEvent, 'id'>): ArReminderEvent {
  const event: ArReminderEvent = { ...input, id: generateId() };
  const all = readStore();
  all.push(event);
  writeStore(all);
  return event;
}

function withinRetention(e: ArReminderEvent, now: number): boolean {
  return now - e.timestamp <= RETENTION_DAYS * DAY_MS;
}

/** Events within the retention window (newest first), optionally by entityId. */
export function getArReminders(entityId?: string, now: number = Date.now()): ArReminderEvent[] {
  return readStore()
    .filter((e) => withinRetention(e, now))
    .filter((e) => (entityId ? e.entityId === entityId : true))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Most-recent reminder for a given entity, or null. */
export function getLastArReminder(entityId: string, now: number = Date.now()): ArReminderEvent | null {
  const list = getArReminders(entityId, now);
  return list.length > 0 ? list[0] : null;
}
