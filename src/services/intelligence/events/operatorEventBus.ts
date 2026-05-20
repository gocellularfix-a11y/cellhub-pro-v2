// R-OPERATOR-EVENTS-V1 — Session-only operator event bus.
// No localStorage, no persistence, no async, no cloud, no side effects outside module.

import type { OperatorEvent, OperatorEventType } from './types';

const MAX_EVENTS = 250;

let _events: OperatorEvent[] = [];

// ── Subscribers ───────────────────────────────────────────────────────────────

type EventListener = (event: OperatorEvent) => void;
let _listeners: EventListener[] = [];

/**
 * Registers a synchronous listener that is called after each published event.
 * Returns an unsubscribe function. Listeners are notified in registration order.
 */
export function subscribeOperatorEvents(listener: EventListener): () => void {
  _listeners = [..._listeners, listener];
  return () => {
    _listeners = _listeners.filter(l => l !== listener);
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Publishes an event into the session bus.
 *
 * If an event with the same id already exists it is replaced in-place.
 * When the total count exceeds MAX_EVENTS the oldest events are dropped.
 * All registered subscribers are notified synchronously after storage.
 */
export function publishOperatorEvent(event: Omit<OperatorEvent, 'createdAt'>): OperatorEvent {
  const full: OperatorEvent = { ...event, createdAt: Date.now() };

  const existingIdx = _events.findIndex(e => e.id === full.id);
  if (existingIdx !== -1) {
    _events = [
      ..._events.slice(0, existingIdx),
      full,
      ..._events.slice(existingIdx + 1),
    ];
  } else {
    const next = [..._events, full];
    _events = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
  }

  const published = { ...full };
  const snapshot = [..._listeners];
  for (const listener of snapshot) {
    listener(published);
  }

  return published;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns a shallow copy of all events (never the internal reference). */
export function getOperatorEvents(): OperatorEvent[] {
  return [..._events];
}

/** Returns a shallow copy of events matching the given type. */
export function getOperatorEventsByType(type: OperatorEventType): OperatorEvent[] {
  return _events.filter(e => e.type === type);
}

/** Wipes all events (e.g. session end / test teardown). */
export function clearOperatorEvents(): void {
  _events = [];
}
