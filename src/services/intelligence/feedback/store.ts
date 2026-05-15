// R-INTELLIGENCE-FEEDBACK-LOOP-V1
// localStorage-backed feedback event log. Append-only, FIFO-capped.
// No ML, no server, no sync — pure deterministic local state.

import type { IntelligenceFeedbackEvent, IntelligenceFeedbackType } from './types';

const FEEDBACK_KEY = 'cellhub:intelligenceFeedback:v1';
const MAX_EVENTS   = 1000;

function read(): IntelligenceFeedbackEvent[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IntelligenceFeedbackEvent[]) : [];
  } catch { return []; }
}

function write(events: IntelligenceFeedbackEvent[]): void {
  try {
    const trimmed = events.length > MAX_EVENTS
      ? events.slice(events.length - MAX_EVENTS)
      : events;
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(trimmed));
  } catch { /* quota / incognito — best-effort */ }
}

// ── Public reads ─────────────────────────────────────────────────

export function getFeedbackEvents(): IntelligenceFeedbackEvent[] {
  return read();
}

export interface FeedbackSummary {
  useful: number;
  resolved: number;
  not_useful: number;
  snoozed: number;
  ignored: number;
  total: number;
}

// O(n) scan filtered by fingerprint. Small dataset — fast in practice.
export function getFeedbackSummary(fingerprint: string): FeedbackSummary {
  const events = read().filter(e => e.fingerprint === fingerprint);
  const s: FeedbackSummary = { useful: 0, resolved: 0, not_useful: 0, snoozed: 0, ignored: 0, total: 0 };
  for (const e of events) {
    if (e.type in s) (s[e.type as keyof Omit<FeedbackSummary, 'total'>])++;
    s.total++;
  }
  return s;
}

// ── Public writes ─────────────────────────────────────────────────

export function addFeedbackEvent(
  input: { queueItemId: string; fingerprint?: string; type: IntelligenceFeedbackType },
): void {
  const event: IntelligenceFeedbackEvent = {
    // Inline ID avoids external dependency; uniqueness sufficient for local log.
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    queueItemId: input.queueItemId,
    fingerprint: input.fingerprint,
    type: input.type,
    createdAt: Date.now(),
  };
  write([...read(), event]);
}
