// ============================================================
// CellHub Pro — Companion Event Bus (R-COMPANION-EVENT-LAYER-V1)
//
// Lightweight in-memory publish / subscribe. Lets desktop modules
// (approvals, messaging, store status, intelligence) emit Companion
// events today without coupling to a transport. The mock bridge
// receives every emit so a future cloud transport can attach without
// touching emitters.
//
// Cero polling, cero intervals, cero networking. Listeners are
// invoked synchronously in registration order; each callback is
// try/catch isolated so one bad listener doesn't poison the rest.
// ============================================================

import type {
  CompanionEvent,
  CompanionEventListener,
  CompanionEventType,
} from './companionTypes';
import { forward as forwardToBridge } from './companionMockBridge';

const WILDCARD = '*' as const;
type ChannelKey = CompanionEventType | typeof WILDCARD;

const listeners: Map<ChannelKey, Set<CompanionEventListener>> = new Map();

// Bounded log so the debug panel can render "last event" without
// growing memory indefinitely.
const LOG_CAP = 64;
const eventLog: CompanionEvent[] = [];

function safeInvoke(listener: CompanionEventListener, event: CompanionEvent): void {
  try {
    listener(event);
  } catch (err) {
    console.warn('[companion-bus] listener threw for', event.type, err);
  }
}

/**
 * Emit a typed Companion event. Fans out to type-matched listeners,
 * then to wildcard subscribers, then forwards to the mock bridge.
 */
export function emit(event: CompanionEvent): void {
  eventLog.push(event);
  if (eventLog.length > LOG_CAP) {
    eventLog.splice(0, eventLog.length - LOG_CAP);
  }

  const targeted = listeners.get(event.type);
  if (targeted) targeted.forEach((l) => safeInvoke(l, event));

  const wild = listeners.get(WILDCARD);
  if (wild) wild.forEach((l) => safeInvoke(l, event));

  forwardToBridge(event);
}

/**
 * Subscribe to a specific event type. Returns an unsubscribe handle
 * so consumers (React useEffect callers) can clean up safely.
 */
export function subscribe(
  type: CompanionEventType,
  listener: CompanionEventListener,
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(type);
  };
}

/**
 * Subscribe to every event. Used by the debug panel + future
 * Companion sync engine that consumes the firehose.
 */
export function subscribeAll(listener: CompanionEventListener): () => void {
  let set = listeners.get(WILDCARD);
  if (!set) {
    set = new Set();
    listeners.set(WILDCARD, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(WILDCARD);
  };
}

/** Latest event (most recent emit), or null if none have been emitted. */
export function getLastEvent(): CompanionEvent | null {
  if (eventLog.length === 0) return null;
  return eventLog[eventLog.length - 1];
}

/** Most-recent slice of the bounded log. Caller-friendly snapshot copy. */
export function getRecentEvents(limit = 16): CompanionEvent[] {
  return eventLog.slice(-Math.max(1, limit));
}

/** Drop the in-memory log. Listener registrations are untouched. */
export function clearEventLog(): void {
  eventLog.length = 0;
}

/** Total registered listeners across all channels — diagnostic helper. */
export function getListenerCount(): number {
  let n = 0;
  listeners.forEach((s) => { n += s.size; });
  return n;
}
