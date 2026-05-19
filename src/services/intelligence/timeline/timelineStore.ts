// INTELLIGENCE-OPERATOR-TIMELINE-V1
// localStorage-backed timeline store. Session + cross-session persistence.
// Safe against unavailable storage and corrupt JSON.

import type { OperatorTimelineEvent } from './types';

const STORAGE_KEY = 'cellhub:intelligence:timeline:v1';
const MAX_EVENTS  = 200;

function load(): OperatorTimelineEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OperatorTimelineEvent[]) : [];
  } catch {
    return [];
  }
}

function save(events: OperatorTimelineEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch { /* storage unavailable — silent */ }
}

/** Append a new event. Trims to the latest MAX_EVENTS automatically. */
export function recordTimelineEvent(event: OperatorTimelineEvent): void {
  const events = load();
  events.push(event);
  save(events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events);
}

export function getTimelineEvents(): OperatorTimelineEvent[] {
  return load();
}

export function clearTimelineEvents(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* silent */ }
}
