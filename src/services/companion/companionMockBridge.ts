// ============================================================
// CellHub Pro — Companion Mock Bridge (R-COMPANION-EVENT-LAYER-V1)
//
// Stand-in for the future transport layer (websocket / Electron IPC /
// cloud sync). Today: holds an in-memory queue and a connection-state
// flag that the event bus forwards events to.
//
// Cero networking. Cero persistence. The queue is bounded so a long
// disconnected session can't exhaust memory.
// ============================================================

import type {
  CompanionConnectionListener,
  CompanionConnectionState,
  CompanionEvent,
} from './companionTypes';

const QUEUE_CAP = 200;

let connectionState: CompanionConnectionState = 'disconnected';
const stateListeners = new Set<CompanionConnectionListener>();
const queue: CompanionEvent[] = [];

function notifyStateListeners(state: CompanionConnectionState): void {
  stateListeners.forEach((l) => {
    try { l(state); } catch (err) { console.warn('[companion-bridge] state listener threw', err); }
  });
}

/** Read current mock connection state. */
export function getConnectionState(): CompanionConnectionState {
  return connectionState;
}

/**
 * Move the mock connection forward. A real transport would set
 * 'connecting' during handshake, then 'connected' once acknowledged.
 * 'connected' triggers a mock drain of the queue — production will
 * ship the queued events to the cloud transport here.
 */
export function setConnectionState(next: CompanionConnectionState): void {
  if (next === connectionState) return;
  connectionState = next;
  notifyStateListeners(next);
  if (next === 'connected') {
    // Mock drain. Real transport replaces this with batch upload.
    queue.length = 0;
  }
}

export function subscribeConnectionState(listener: CompanionConnectionListener): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

/**
 * Called by companionEventBus.emit AFTER local fanout. When the bridge
 * is disconnected we queue the event for future delivery; when
 * connected we'd normally hand it off to the transport (no-op today,
 * cero networking).
 */
export function forward(event: CompanionEvent): void {
  if (connectionState !== 'connected') {
    queue.push(event);
    if (queue.length > QUEUE_CAP) {
      // Drop oldest. Loud-fail via console so a runaway producer is
      // visible during development.
      queue.splice(0, queue.length - QUEUE_CAP);
      console.warn('[companion-bridge] queue cap reached, dropping oldest events');
    }
  }
  // Connected branch is intentionally empty in V1.
}

export function getQueueSize(): number {
  return queue.length;
}

export function clearQueue(): void {
  queue.length = 0;
}
