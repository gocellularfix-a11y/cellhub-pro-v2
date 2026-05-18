// R-OUTREACH-OUTCOME-FEEDBACK-V1
// Append-only localStorage store for outreach outcome events.
// Historical events are never mutated. Parsing guards on every read.

import type { OutreachOutcomeEvent, OutreachOutcomeType, OutreachGroup } from './outreachOutcomeTypes';
import { generateId } from '@/utils/dates';

const STORE_KEY = 'cellhub:intelligence:outreachOutcomes:v1';
const MAX_EVENTS = 2000;
const DEFAULT_RETENTION_DAYS = 90;

function readStore(): OutreachOutcomeEvent[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is OutreachOutcomeEvent =>
        e !== null &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.customerId === 'string' &&
        typeof e.outreachGroup === 'string' &&
        typeof e.outcome === 'string' &&
        typeof e.timestamp === 'number',
    );
  } catch { return []; }
}

function writeStore(events: OutreachOutcomeEvent[]): void {
  try {
    const trimmed = events.length > MAX_EVENTS
      ? events.slice(events.length - MAX_EVENTS)
      : events;
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch { /* quota/incognito — best-effort */ }
}

export function recordOutreachOutcome(
  customerId: string,
  outreachGroup: OutreachGroup,
  outcome: OutreachOutcomeType,
  metadata?: Record<string, unknown>,
): void {
  const event: OutreachOutcomeEvent = {
    id: generateId(),
    customerId,
    outreachGroup,
    outcome,
    timestamp: Date.now(),
    ...(metadata ? { metadata } : {}),
  };
  const events = readStore();
  events.push(event);
  writeStore(events);
}

export function getOutreachOutcomes(customerId?: string): OutreachOutcomeEvent[] {
  const events = readStore();
  if (!customerId) return events;
  return events.filter((e) => e.customerId === customerId);
}

export function getRecentOutreachOutcomes(days = DEFAULT_RETENTION_DAYS): OutreachOutcomeEvent[] {
  const cutoff = Date.now() - days * 86_400_000;
  return readStore().filter((e) => e.timestamp >= cutoff);
}

export interface CustomerOutcomeStats {
  customerId: string;
  total: number;
  replied: number;
  converted: number;
  ignored: number;
  lastOutcome?: OutreachOutcomeType;
  lastOutcomeAt?: number;
}

export function getCustomerOutcomeStats(customerId: string): CustomerOutcomeStats {
  const events = getOutreachOutcomes(customerId);
  const stats: CustomerOutcomeStats = {
    customerId,
    total: events.length,
    replied: 0,
    converted: 0,
    ignored: 0,
  };
  for (const e of events) {
    if (e.outcome === 'replied') stats.replied++;
    if (
      e.outcome === 'payment_collected' ||
      e.outcome === 'repair_picked_up' ||
      e.outcome === 'sale_completed' ||
      e.outcome === 'visited_store'
    ) {
      stats.converted++;
    }
    if (e.outcome === 'ignored') stats.ignored++;
  }
  if (events.length > 0) {
    const last = events[events.length - 1];
    stats.lastOutcome = last.outcome;
    stats.lastOutcomeAt = last.timestamp;
  }
  return stats;
}
