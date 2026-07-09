// ============================================================
// R-INTEL-V2-PHASE1B — AR reminder tracking store.
// Exercises the pure append-only store (record / read / last / retention /
// parse-guard / preview) against a mock localStorage. Node test env has no
// real localStorage — mirror the MockLocalStorage pattern used by the other
// intelligence store tests.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordArReminder,
  getArReminders,
  getLastArReminder,
  buildMessagePreview,
  type ArReminderEvent,
} from './arReminderStore';

const STORE_KEY = 'cellhub:intelligence:arReminders:v1';

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? (this.store.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  get length(): number { return this.store.size; }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MockLocalStorage();
});

function ev(over: Partial<Omit<ArReminderEvent, 'id'>> = {}): Omit<ArReminderEvent, 'id'> {
  return {
    type: 'ar_reminder_copied',
    channel: 'copy',
    customerName: 'Ana',
    entityType: 'repair',
    entityId: 'r1',
    balanceCents: 4500,
    language: 'en',
    messagePreview: 'hi',
    timestamp: 1_000_000,
    source: 'unpaid_balances',
    ...over,
  };
}

describe('arReminderStore', () => {
  it('records and reads back an event, preserving balanceCents as an integer', () => {
    recordArReminder(ev({ balanceCents: 12399 }));
    const all = getArReminders(undefined, 1_000_000);
    expect(all.length).toBe(1);
    expect(all[0].balanceCents).toBe(12399);
    expect(Number.isInteger(all[0].balanceCents)).toBe(true);
    expect(all[0].source).toBe('unpaid_balances');
  });

  it('getLastArReminder returns the most recent event for an entity', () => {
    recordArReminder(ev({ entityId: 'r1', timestamp: 1000 }));
    recordArReminder(ev({ entityId: 'r1', timestamp: 5000, channel: 'whatsapp', type: 'ar_reminder_whatsapp_opened' }));
    recordArReminder(ev({ entityId: 'r2', timestamp: 9000 }));
    const last = getLastArReminder('r1', 10_000);
    expect(last?.timestamp).toBe(5000);
    expect(last?.type).toBe('ar_reminder_whatsapp_opened');
    // isolated per entity
    expect(getLastArReminder('r2', 10_000)?.timestamp).toBe(9000);
    expect(getLastArReminder('nope', 10_000)).toBeNull();
  });

  it('excludes events older than the 90-day retention window', () => {
    const now = 100 * 86_400_000;
    recordArReminder(ev({ entityId: 'old', timestamp: now - 91 * 86_400_000 }));
    recordArReminder(ev({ entityId: 'new', timestamp: now - 10 * 86_400_000 }));
    const within = getArReminders(undefined, now);
    expect(within.map((e) => e.entityId)).toEqual(['new']);
  });

  it('returns [] on corrupt storage (parse guard, never throws)', () => {
    localStorage.setItem(STORE_KEY, '{not valid json');
    expect(getArReminders()).toEqual([]);
    expect(getLastArReminder('r1')).toBeNull();
  });

  it('never throws when localStorage is unavailable', () => {
    delete (globalThis as any).localStorage;
    expect(() => recordArReminder(ev())).not.toThrow();
    expect(getArReminders()).toEqual([]);
  });

  it('buildMessagePreview collapses whitespace and truncates long text', () => {
    expect(buildMessagePreview('  hi\n\n there  ')).toBe('hi there');
    const long = 'x'.repeat(500);
    const preview = buildMessagePreview(long);
    expect(preview.length).toBeLessThanOrEqual(240);
    expect(preview.endsWith('…')).toBe(true);
  });
});
